import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { derivedDefaults, run, verdict, type Inputs, type YearData } from "../src/model";
import { BATTERY_PRICE, ASSUMPTIONS } from "../src/defaults";
import { INDEXED_DEFAULTS } from "../src/tariffs";

const year = JSON.parse(readFileSync("public/data/year.json", "utf8")) as YearData;
const solar = (code: string) => JSON.parse(readFileSync(`public/data/solar/${code}.json`, "utf8")) as number[];

export function example(name: string, code: string, o: Partial<Inputs>) {
  const s = solar(code);
  const d = derivedDefaults(year, s);
  const size = (o.batteryKwh ?? 10) as 5 | 10 | 15;
  const inp: Inputs = {
    annualKwh: 3500, kwp: 4, solarPerKwp: s, tariff: "pvpc", fixedPrice: d.fixedPrice,
    touPrices: o.tariff === "tou30" ? d.tou30 : d.tou20, indexed: INDEXED_DEFAULTS, exportPrice: d.exportPrice,
    batteryKwh: size, batteryPowerKw: BATTERY_PRICE[size].powerKw, usableShare: ASSUMPTIONS.usableShare.value,
    roundTrip: ASSUMPTIONS.roundTrip.value, gridCharge: true, batteryPrice: BATTERY_PRICE[size].default,
    irpfDeduction: false, degradationPerYear: ASSUMPTIONS.degradation.value, business: false, ...o,
  };
  const r = run(year, inp);
  const line = {
    name, defaults: d, base: Math.round(r.base.energyCost), withBattery: Math.round(r.withBattery.energyCost),
    savings: Math.round(r.savingsYear1), payback: r.paybackYears && +r.paybackYears.toFixed(1),
    paybackDegraded: r.paybackYearsDegraded && +r.paybackYearsDegraded.toFixed(1), net10: Math.round(r.net10),
    cycles: Math.round(r.cyclesPerYear), gridCharged: Math.round(r.gridChargedKwh),
    selfBefore: Math.round(r.base.selfConsumedKwh), selfAfter: Math.round(r.withBattery.selfConsumedKwh),
    exportBefore: Math.round(r.base.exportKwh), exportAfter: Math.round(r.withBattery.exportKwh),
    verdict: verdict(r),
  };
  console.log(JSON.stringify(line));
  return r;
}

describe("worked examples (sanity ranges)", () => {
  it("a) Madrid home, PVPC, 3,500 kWh, 4 kWp, 10 kWh", () => {
    const r = example("a", "28", {});
    example("a-no-grid-charge", "28", { gridCharge: false });
    expect(r.savingsYear1).toBeGreaterThan(100);
    expect(r.savingsYear1).toBeLessThan(900);
  });
  it("b) Seville home, fixed price, 4,000 kWh, 5 kWp, 10 kWh", () => {
    const r = example("b", "41", { tariff: "fixed", annualKwh: 4000, kwp: 5 });
    expect(r.savingsYear1).toBeGreaterThan(100);
  });
  it("c) small business, 3.0TD, Valencia, 30,000 kWh, 15 kWp, 15 kWh", () => {
    const r = example("c", "46", { tariff: "tou30", annualKwh: 30000, kwp: 15, batteryKwh: 15, batteryPowerKw: 6, batteryPrice: Math.round(9500 / 1.21), business: true });
    expect(r.savingsYear1).toBeGreaterThan(50);
  });
});

describe("finance and safeguards", () => {
  it("grid charging never makes the year-1 bill worse than self-consumption only", () => {
    for (const [code, tariff] of [["28", "pvpc"], ["41", "tou20"], ["46", "tou30"], ["15", "indexed"]] as const) {
      const on = example(`gc-on-${code}`, code, { tariff, gridCharge: true, kwp: 0 });
      const off = example(`gc-off-${code}`, code, { tariff, gridCharge: false, kwp: 0 });
      expect(on.withBattery.energyCost).toBeLessThanOrEqual(off.withBattery.energyCost + 1e-9);
    }
  });
  it("IRPF: 10 % up to €500, homes with panels only, and the break-even price accounts for it", () => {
    const r = example("irpf", "28", { irpfDeduction: true, batteryPrice: 7000 });
    expect(r.netPrice).toBe(6500);
    expect(r.irpfApplied).toBe(true);
    const total10 = r.savingsByYear.reduce((a, b) => a + b, 0);
    const p = r.breakEvenPrice10;
    expect(p - 0.1 * Math.min(p, 5000)).toBeCloseTo(total10, 6);
    expect(example("irpf-nosolar", "28", { irpfDeduction: true, kwp: 0 }).irpfApplied).toBe(false);
    expect(example("irpf-biz", "28", { irpfDeduction: true, business: true }).irpfApplied).toBe(false);
  });
});
