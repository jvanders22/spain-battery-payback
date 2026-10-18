import { simulate, type Battery, type Flows, type Hourly } from "./dispatch";
import { INDEXED_DEFAULTS, indexedPreTax, period, regulated, withTaxes, type IndexedAssumptions, type Tariff } from "./tariffs";

export interface YearData {
  month: number[];
  day: number[];
  hour: number[];
  dow: number[];
  yday: number[];
  omie: number[]; // EUR/MWh
  pvpc: number[]; // EUR/MWh before taxes (PCB)
  load20: number[]; // shares of annual consumption, sum 1
  load30: number[];
}

export type TariffKind = "fixed" | "pvpc" | "indexed" | "tou20" | "tou30";

export interface Inputs {
  annualKwh: number;
  kwp: number;
  solarPerKwp: number[]; // kWh per kWp per hour (8760)
  tariff: TariffKind;
  fixedPrice: number; // EUR/kWh before taxes
  touPrices: number[]; // EUR/kWh before taxes per period (3 for 2.0TD, 6 for 3.0TD)
  indexed: IndexedAssumptions;
  exportPrice: number; // EUR/kWh, simplified net billing
  batteryKwh: number;
  batteryPowerKw: number;
  usableShare: number; // 0.95
  roundTrip: number; // 0.9
  gridCharge: boolean;
  batteryPrice: number; // EUR, as paid
  irpfDeduction: boolean; // 10 % of up to 5,000 EUR, homes, paid and finished in 2026
  degradationPerYear: number; // 0.02
  business: boolean; // 3.0TD business: IVA not a cost
}

export function tariffCode(k: TariffKind): Tariff {
  return k === "tou30" ? "3.0TD" : "2.0TD";
}

/** Import price before taxes, EUR/kWh, for every hour. */
export function importPrices(y: YearData, inp: Pick<Inputs, "tariff" | "fixedPrice" | "touPrices" | "indexed">): Float64Array {
  const n = y.hour.length;
  const out = new Float64Array(n);
  const t = tariffCode(inp.tariff);
  for (let i = 0; i < n; i++) {
    const p = period(t, y.month[i], y.day[i], y.dow[i], y.hour[i]);
    switch (inp.tariff) {
      case "fixed":
        out[i] = inp.fixedPrice;
        break;
      case "pvpc":
        out[i] = y.pvpc[i] / 1000;
        break;
      case "indexed":
        out[i] = indexedPreTax(t, p, y.omie[i], inp.indexed);
        break;
      default:
        out[i] = inp.touPrices[p - 1];
    }
  }
  return out;
}

export function hourly(y: YearData, inp: Inputs, price: Float64Array): Hourly {
  const n = y.hour.length;
  const shape = inp.tariff === "tou30" ? y.load30 : y.load20;
  const load = new Float64Array(n);
  const solar = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    load[i] = shape[i] * inp.annualKwh;
    solar[i] = inp.solarPerKwp[i] * inp.kwp;
  }
  return { load, solar, price, hour: Uint8Array.from(y.hour) };
}

export interface Bill {
  energyCost: number; // EUR/yr after compensation, with taxes (energy part only)
  importKwh: number;
  exportKwh: number;
  selfConsumedKwh: number;
  compensated: number; // EUR of exports credited (before taxes)
  lostExportValue: number; // EUR of exports above the monthly cap
}

/** Simplified net billing (RD 244/2019 art. 14): monthly, credit = exports × price, capped at the month's
 * energy cost; IEE and IVA apply to what is left. */
export function bill(y: YearData, h: Hourly, f: Flows, exportPrice: number, includeIva: boolean): Bill {
  const energy = new Array(13).fill(0);
  const credit = new Array(13).fill(0);
  let importKwh = 0;
  let exportKwh = 0;
  let load = 0;
  for (let i = 0; i < h.load.length; i++) {
    const m = y.month[i];
    energy[m] += f.imp[i] * h.price[i];
    credit[m] += f.exp[i] * exportPrice;
    importKwh += f.imp[i];
    exportKwh += f.exp[i];
    load += h.load[i];
  }
  let cost = 0;
  let compensated = 0;
  let lost = 0;
  for (let m = 1; m <= 12; m++) {
    const c = Math.min(credit[m], Math.max(0, energy[m]));
    compensated += c;
    lost += credit[m] - c;
    cost += withTaxes(energy[m] - c, includeIva);
  }
  const selfConsumedKwh = load - (importKwh - f.gridCharged);
  return { energyCost: cost, importKwh, exportKwh, selfConsumedKwh, compensated, lostExportValue: lost };
}

export interface Result {
  base: Bill;
  withBattery: Bill;
  savingsYear1: number;
  savingsByYear: number[];
  netPrice: number;
  paybackYears: number | null; // simple payback on year-1 savings
  paybackYearsDegraded: number | null; // year in which cumulative degraded savings pass the price
  net10: number;
  breakEvenPrice10: number; // battery price at which 10-year savings = price
  cyclesPerYear: number;
  gridChargedKwh: number;
  flows: Flows;
  baseFlows: Flows;
  hourly: Hourly;
}

export function battery(inp: Inputs, year = 0): Battery {
  const fade = Math.max(0, 1 - inp.degradationPerYear * year);
  return {
    capacityKwh: inp.batteryKwh * inp.usableShare * fade,
    powerKw: inp.batteryPowerKw,
    roundTrip: inp.roundTrip,
    gridCharge: inp.gridCharge && inp.tariff !== "fixed",
  };
}

export function run(y: YearData, inp: Inputs): Result {
  const price = importPrices(y, inp);
  const h = hourly(y, inp, price);
  const iva = !inp.business;
  const baseFlows = simulate(h, null);
  const base = bill(y, h, baseFlows, inp.exportPrice, iva);
  const flows = simulate(h, battery(inp, 0));
  const withBattery = bill(y, h, flows, inp.exportPrice, iva);
  const savingsByYear: number[] = [];
  for (let yr = 0; yr < 10; yr++) {
    const f = yr === 0 ? flows : simulate(h, battery(inp, yr));
    savingsByYear.push(base.energyCost - (yr === 0 ? withBattery : bill(y, h, f, inp.exportPrice, iva)).energyCost);
  }
  const deduction = inp.irpfDeduction && !inp.business ? 0.1 * Math.min(inp.batteryPrice, 5000) : 0;
  const netPrice = inp.batteryPrice - deduction;
  const s1 = savingsByYear[0];
  const total10 = savingsByYear.reduce((a, b) => a + b, 0);
  let cum = 0;
  let degraded: number | null = null;
  for (let yr = 0; yr < 30 && degraded === null; yr++) {
    const s = savingsByYear[Math.min(yr, 9)] * (yr > 9 ? Math.max(0, 1 - inp.degradationPerYear * (yr - 9)) : 1);
    if (s <= 0) break;
    if (cum + s >= netPrice) degraded = yr + (netPrice - cum) / s;
    cum += s;
  }
  return {
    base,
    withBattery,
    savingsYear1: s1,
    savingsByYear,
    netPrice,
    paybackYears: s1 > 0 ? netPrice / s1 : null,
    paybackYearsDegraded: degraded,
    net10: total10 - netPrice,
    breakEvenPrice10: total10 + deduction,
    cyclesPerYear: inp.batteryKwh > 0 ? flows.discharged / (inp.batteryKwh * inp.usableShare) : 0,
    gridChargedKwh: flows.gridCharged,
    flows,
    baseFlows,
    hourly: h,
  };
}

export function verdict(r: Result): string {
  const p = r.paybackYearsDegraded;
  const lower = Math.max(0, Math.floor(r.breakEvenPrice10 / 100) * 100);
  if (r.savingsYear1 > 0 && p === null) {
    return `Does not pay back within 30 years: it saves about €${fmt(r.savingsYear1)} a year against a price of €${fmt(r.netPrice)}. It would need to cost under €${fmt(lower)} to pay back in 10 years.`;
  }
  if (r.savingsYear1 <= 0 || p === null) {
    return "Does not pay back: with these inputs the battery saves nothing, because your solar surplus and price differences are too small to use it.";
  }
  const y = Math.round(p);
  if (p <= 7) return `Pays back in about ${y} years, well inside a typical 10-year warranty. Likely worth it, if the quote is close to the one assumed here.`;
  if (p <= 10) return `Pays back in about ${y} years: worth it only if the battery lasts its full 10-year warranty and electricity prices do not fall. A quote under €${fmt(lower)} would make it clearly worth it.`;
  if (p <= 15) return `Pays back in about ${y} years, longer than a typical 10-year warranty. Worth it only if the battery lasts well beyond its warranty, prices rise, or you get a quote under €${fmt(lower)}.`;
  return `Unlikely to pay back within the battery's life (about ${y > 30 ? "30+" : y} years). It would need to cost under €${fmt(lower)} to pay back in 10 years.`;
}

export function fmt(x: number, digits = 0): string {
  return x.toLocaleString("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export { INDEXED_DEFAULTS };

/** Defaults derived from the 2025 data, so every default number has a source. */
export function derivedDefaults(y: YearData, solarPerKwp: number[]) {
  let pvpcW = 0;
  let w = 0;
  let omieW = 0;
  let solarW = 0;
  let omieSolar = 0;
  for (let i = 0; i < y.hour.length; i++) {
    pvpcW += y.load20[i] * y.pvpc[i];
    omieW += y.load20[i] * y.omie[i];
    w += y.load20[i];
    solarW += solarPerKwp[i];
    omieSolar += solarPerKwp[i] * Math.max(0, y.omie[i]);
  }
  const a = INDEXED_DEFAULTS;
  const energyPart = (omieW / w + a.adjustmentEurMwh) / 1000 * (1 + a.lossFactor) + a.marginEurMwh / 1000;
  return {
    fixedPrice: round4(pvpcW / w / 1000), // consumption-weighted 2025 PVPC, before taxes
    tou20: [1, 2, 3].map((p) => round4(energyPart + regulated("2.0TD", p))),
    tou30: [1, 2, 3, 4, 5, 6].map((p) => round4(energyPart + regulated("3.0TD", p))),
    exportPrice: round4(omieSolar / solarW / 1000), // solar-weighted 2025 OMIE (negatives as 0)
    energyPart: round4(energyPart),
  };
}

function round4(x: number) {
  return Math.round(x * 10000) / 10000;
}
