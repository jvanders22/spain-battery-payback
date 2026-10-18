import "./style.css";
import { render } from "./chart";
import { loadGoatCounter } from "./config";
import { ASSUMPTIONS, BATTERY_PRICE, IRPF, PRICE_SOURCES, type Size } from "./defaults";
import { derivedDefaults, fmt, importPrices, run, verdict, type Inputs, type TariffKind, type YearData } from "./model";
import { INDEXED_DEFAULTS, SOURCES, withTaxes } from "./tariffs";

interface Province { code: string; name: string; capital: string; yield_kwh_kwp: number }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
/** Read a number field; empty or invalid falls back to the field's default value. */
const val = (id: string) => {
  const el = $(id) as HTMLInputElement;
  const x = parseFloat(el.value);
  return Number.isFinite(x) ? x : parseFloat(el.defaultValue || "0") || 0;
};
const radio = (name: string) => (document.querySelector(`input[name="${name}"]:checked`) as HTMLInputElement).value;

let year: YearData;
let provinces: Province[] = [];
const solarCache = new Map<string, number[]>();
const edited = new Set<string>();

// editable assumptions: id -> [label, default, note, step]
type Field = { id: string; label: string; value: number; note: string; step: number; show?: (t: TariffKind) => boolean };
let fields: Field[] = [];

async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json() as Promise<T>;
}

async function solar(code: string) {
  if (!solarCache.has(code)) solarCache.set(code, await getJSON<number[]>(`data/solar/${code}.json`));
  return solarCache.get(code)!;
}

function buildFields(d: ReturnType<typeof derivedDefaults>) {
  const touNames20 = ["P1 punta", "P2 llano", "P3 valle"];
  fields = [
    { id: "a_fixed", label: "Fixed price, €/kWh before taxes", value: d.fixedPrice, step: 0.001, show: (t) => t === "fixed",
      note: "ESTIMATE. Default: 2025 PVPC averaged over the REE 2.0TD consumption profile (REE archive 70, field PCB). Use the energy price on your bill." },
    ...touNames20.map((n, i) => ({ id: `a_tou20_${i}`, label: `2.0TD ${n}, €/kWh before taxes`, value: d.tou20[i], step: 0.001, show: (t: TariffKind) => t === "tou20",
      note: i === 0 ? `ESTIMATE. Default: 2025 average market energy (€${d.energyPart.toFixed(4)}/kWh: OMIE + 28 €/MWh services + 16 % losses + 10 €/MWh margin) plus the official 2026 peaje and cargo for the period. Use your contract's prices.` : "" })),
    ...[1, 2, 3, 4, 5, 6].map((p, i) => ({ id: `a_tou30_${i}`, label: `3.0TD P${p}, €/kWh before taxes`, value: d.tou30[i], step: 0.001, show: (t: TariffKind) => t === "tou30",
      note: i === 0 ? "ESTIMATE. Same method as 2.0TD with the 3.0TD peajes and cargos 2026. Use your contract's prices." : "" })),
    { id: "a_adj", label: "Indexed: services and fees, €/MWh", value: INDEXED_DEFAULTS.adjustmentEurMwh, step: 1, show: (t) => t === "indexed",
      note: "ASSUMPTION, from the price calculator in spain-negative-price-alert (median PVPC adjustment components)." },
    { id: "a_margin", label: "Indexed: retailer margin, €/MWh", value: INDEXED_DEFAULTS.marginEurMwh, step: 1, show: (t) => t === "indexed", note: "ASSUMPTION. Illustrative." },
    { id: "a_loss", label: "Indexed: network losses, share", value: INDEXED_DEFAULTS.lossFactor, step: 0.01, show: (t) => t === "indexed", note: "ASSUMPTION. Same calculator." },
    { id: "a_rt", label: "Round-trip efficiency", value: ASSUMPTIONS.roundTrip.value, step: 0.01, note: ASSUMPTIONS.roundTrip.note },
    { id: "a_usable", label: "Usable share of capacity", value: ASSUMPTIONS.usableShare.value, step: 0.01, note: ASSUMPTIONS.usableShare.note },
    { id: "a_deg", label: "Capacity loss per year", value: ASSUMPTIONS.degradation.value, step: 0.005, note: ASSUMPTIONS.degradation.note },
    { id: "a_power", label: "Battery power, kW", value: BATTERY_PRICE[10].powerKw, step: 0.5, note: "From the SolarPlan size table (5 kWh: 3.6 kW, 10 kWh: 5 kW, 15 kWh: 6 kW); 5 kWh rounded down to 3 kW." },
    { id: "a_billshare", label: "Energy share of a monthly bill", value: ASSUMPTIONS.billEnergyShare.value, step: 0.05, show: () => radio("consMode") === "bill", note: ASSUMPTIONS.billEnergyShare.note },
  ];
  const box = $("assumptionFields");
  box.replaceChildren();
  for (const f of fields) {
    const wrap = document.createElement("div");
    wrap.dataset.field = f.id;
    wrap.innerHTML = `<label class="field"><span>${f.label}</span><input id="${f.id}" type="number" inputmode="decimal" step="${f.step}" value="${f.value}"></label>${f.note ? `<p class="note">${f.note}</p>` : ""}`;
    box.append(wrap);
  }
}

function setDefault(id: string, v: number) {
  if (!edited.has(id)) ($(id) as HTMLInputElement).value = String(v);
}

function syncVisibility() {
  const t = $<HTMLSelectElement>("tariff").value as TariffKind;
  for (const f of fields) {
    const el = document.querySelector<HTMLElement>(`[data-field="${f.id}"]`)!;
    el.hidden = f.show ? !f.show(t) : false;
  }
  const gc = $<HTMLInputElement>("gridCharge");
  gc.disabled = t === "fixed";
  if (t === "tou30" && !edited.has("who")) (document.querySelector('input[name="who"][value="business"]') as HTMLInputElement).checked = true;
  if (t !== "tou30" && !edited.has("who")) (document.querySelector('input[name="who"][value="home"]') as HTMLInputElement).checked = true;
  const business = radio("who") === "business";
  $("priceVat").textContent = business ? "(without IVA; a business recovers it)" : "(IVA included)";
  const noSolar = !(parseFloat($<HTMLInputElement>("kwp").value) > 0);
  $<HTMLInputElement>("irpf").disabled = business || noSolar;
  if (radio("consMode") === "bill" && !edited.has("consBill")) $<HTMLInputElement>("cons").value = "80";
  if (radio("consMode") === "kwh" && edited.has("modeSwitched") && !edited.has("consKwh")) $<HTMLInputElement>("cons").value = "3500";
  const bill = radio("consMode") === "bill";
  $("consLabel").textContent = bill ? "Average monthly bill, €" : "Annual consumption, kWh";
}

function batteryDefaults() {
  const size = Number(radio("size")) as Size;
  const b = BATTERY_PRICE[size];
  const business = radio("who") === "business";
  const k = business ? 1 / 1.21 : 1;
  setDefault("price", Math.round((b.default * k) / 100) * 100);
  setDefault("a_power", b.powerKw);
  $("priceHint").textContent = `ESTIMATE. Installed ${size} kWh batteries in Spain, 2026: €${fmt(b.low * k)}–${fmt(b.high * k)}${business ? " without IVA" : " with IVA"} across the installer and market pages under Sources. Use your quote.`;
}

async function update() {
  syncVisibility();
  const code = $<HTMLSelectElement>("province").value;
  const s = await solar(code);
  const d = derivedDefaults(year, s);
  setDefault("exportPrice", d.exportPrice);
  $("exportHint").textContent = `ESTIMATE. Default: 2025 OMIE price weighted by solar output in ${provinces.find((p) => p.code === code)?.name} (negative hours count as €0), close to what the regulated compensation paid. Many retailers offer €0.04–0.07: use your contract.`;
  const prov = provinces.find((p) => p.code === code)!;
  $("yieldHint").textContent = `PVGIS: 1 kWp facing south at 30° in ${prov.capital} produced ${fmt(prov.yield_kwh_kwp)} kWh in 2023.`;
  batteryDefaults();
  const tariff = $<HTMLSelectElement>("tariff").value as TariffKind;
  const business = radio("who") === "business";
  const v = (id: string) => val(id);
  const tou = tariff === "tou30" ? [0, 1, 2, 3, 4, 5].map((i) => v(`a_tou30_${i}`)) : [0, 1, 2].map((i) => v(`a_tou20_${i}`));
  const indexed = { adjustmentEurMwh: v("a_adj"), marginEurMwh: v("a_margin"), lossFactor: v("a_loss") };
  let annualKwh = v("cons");
  if (radio("consMode") === "bill") {
    // average price of the chosen tariff over the consumption profile; a bill includes IVA for everyone
    const shape = tariff === "tou30" ? year.load30 : year.load20;
    const prices = importPrices(year, { tariff, fixedPrice: v("a_fixed"), touPrices: tou, indexed });
    let wsum = 0;
    for (let i = 0; i < prices.length; i++) wsum += shape[i] * prices[i];
    const avg = withTaxes(wsum, true);
    annualKwh = (v("cons") * 12 * v("a_billshare")) / avg;
    $("consHint").textContent = `ESTIMATE: about ${fmt(annualKwh)} kWh a year (bill × 12 × ${v("a_billshare")} ÷ ${avg.toFixed(3)} €/kWh, your tariff's average with taxes).`;
  } else $("consHint").textContent = "From your bills: the sum of 12 months, or the annual figure on the bill.";
  const inp: Inputs = {
    annualKwh: Math.max(0, annualKwh || 0), kwp: Math.max(0, v("kwp") || 0), solarPerKwp: s, tariff,
    fixedPrice: v("a_fixed"), touPrices: tou, indexed, exportPrice: Math.max(0, v("exportPrice") || 0),
    batteryKwh: Number(radio("size")), batteryPowerKw: v("a_power"), usableShare: v("a_usable"), roundTrip: v("a_rt"),
    gridCharge: $<HTMLInputElement>("gridCharge").checked, batteryPrice: v("price"), irpfDeduction: $<HTMLInputElement>("irpf").checked,
    degradationPerYear: v("a_deg"), business,
  };
  const r = run(year, inp);
  const size = inp.batteryKwh;
  const where = prov.name;
  const pb = r.paybackYearsDegraded;
  $("headline").textContent = r.savingsYear1 > 0
    ? `A ${size} kWh battery in ${where} would have saved €${fmt(r.savingsYear1)} in 2025${pb ? `, paying back in about ${Math.round(pb)} years` : ". At this price it never pays back"}.`
    : `A ${size} kWh battery in ${where} would have saved nothing in 2025.`;
  $("verdict").textContent = verdict(r);
  $("fSave").textContent = `€${fmt(r.savingsYear1)}`;
  $("fPayback").textContent = pb === null ? (r.savingsYear1 > 0 ? "30+ years" : "never") : `${pb.toFixed(1)} years`;
  $("fNet").textContent = `${r.net10 < 0 ? "−" : "+"}€${fmt(Math.abs(r.net10))}`;
  $("fNet").classList.toggle("neg", r.net10 < 0);
  const simple = r.paybackYears === null ? "never" : `${r.paybackYears.toFixed(1)} years`;
  const gcNote = inp.gridCharge && tariff !== "fixed" && !r.gridChargeUsed ? "; night charging from the grid did not lower the bill, so it is off" : r.gridChargedKwh > 1 ? `; it buys ${fmt(r.gridChargedKwh)} kWh from the grid at night` : "";
  $("resultNote").textContent = `price paid €${fmt(r.netPrice)}${r.irpfApplied ? " after the IRPF deduction" : ""}; payback allows for capacity loss each year (on year-1 savings alone: ${simple}). The battery cycles about ${Math.round(r.cyclesPerYear)} times a year${gcNote}.`;
  const rows: [string, string, string][] = [
    ["Consumption, kWh", fmt(inp.annualKwh), fmt(inp.annualKwh)],
    ["Solar used directly or via battery, kWh", fmt(r.base.selfConsumedKwh), fmt(r.withBattery.selfConsumedKwh)],
    ["Bought from the grid, kWh", fmt(r.base.importKwh), fmt(r.withBattery.importKwh)],
    ["Exported, kWh", fmt(r.base.exportKwh), fmt(r.withBattery.exportKwh)],
    ["Export credit used, €", fmt(r.base.compensated), fmt(r.withBattery.compensated)],
    ["Export value lost to the monthly cap, €", fmt(r.base.lostExportValue), fmt(r.withBattery.lostExportValue)],
    [`Energy part of the bill, € (with IEE${business ? "" : " and IVA"})`, fmt(r.base.energyCost), fmt(r.withBattery.energyCost)],
  ];
  $("flows").querySelector("tbody")!.innerHTML = rows.map(([a, b, c]) => `<tr><th scope="row">${a}</th><td>${b}</td><td>${c}</td></tr>`).join("");
  render($("chart"), year, r);
  $("result").setAttribute("aria-busy", "false");
}

function sources() {
  const items = [
    `<a href="https://www.omie.es/en/market-results">OMIE day-ahead market results</a>, Spain, 2025 hourly (mean of published periods).`,
    `<a href="https://api.esios.ree.es/archives/70/download_json?locale=es&date=2025-07-15">REE/ESIOS archive 70</a>: PVPC 2.0TD hourly prices (field PCB, before taxes), every day of 2025.`,
    `<a href="https://re.jrc.ec.europa.eu/pvg_tools/en/">PVGIS 5.3</a> (JRC), hourly PV output 2023, 1 kWp, 30° south, 14 % system losses, one point per province capital. Free reuse with acknowledgement: PVGIS © European Communities, 2001–2026 (<a href="https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/general-information/usage-conditions-data-protection_en">usage conditions</a>).`,
    `<a href="https://www.ree.es/es/clientes/consumidor/gestion-medidas-electricas/consulta-perfiles-de-consumo">REE perfiles iniciales de consumo 2026</a> (P2.0TD homes, P3.0TD small businesses), aligned to 2025 by weekday.`,
    `<a href="${SOURCES.peajes.url}">${SOURCES.peajes.title}</a>; <a href="${SOURCES.cargos.url}">${SOURCES.cargos.title}</a>; <a href="${SOURCES.periods.url}">${SOURCES.periods.title}</a>.`,
    `Surplus compensation: <a href="https://www.boe.es/buscar/act.php?id=BOE-A-2019-5089">Real Decreto 244/2019</a>, art. 14 (simplified net billing, monthly cap).`,
    `Taxes: IEE 5.11269632 % (<a href="https://www.boe.es/buscar/act.php?id=BOE-A-1992-28741">Ley 38/1992</a>, art. 99) and IVA 21 %.`,
    `IRPF: ${IRPF.note} <a href="${IRPF.url}">${IRPF.ref}</a>. No regional subsidies are modelled: none were verified for 2026.`,
    ...PRICE_SOURCES.map((p) => `Battery prices: <a href="${p.url}">${p.name}</a>, ${p.date}: ${p.quote}.`),
  ];
  $("sourceList").innerHTML = items.map((i) => `<li>${i}</li>`).join("");
}

async function main() {
  loadGoatCounter();
  sources();
  [year, provinces] = await Promise.all([getJSON<YearData>("data/year.json"), getJSON<Province[]>("data/provinces.json")]);
  const sel = $<HTMLSelectElement>("province");
  sel.innerHTML = provinces.map((p) => `<option value="${p.code}"${p.code === "28" ? " selected" : ""}>${p.name}</option>`).join("");
  buildFields(derivedDefaults(year, await solar("28")));
  let t: number | undefined;
  const schedule = () => { clearTimeout(t); t = window.setTimeout(() => void update(), 120); };
  document.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (["price", "exportPrice", "a_power", "a_fixed"].includes(el.id) || el.id.startsWith("a_")) edited.add(el.id);
    if (el.name === "who") { edited.add("who"); edited.delete("price"); }
    if (el.name === "consMode") { edited.add("modeSwitched"); edited.delete("consBill"); edited.delete("consKwh"); }
    if (el.id === "cons") edited.add(radio("consMode") === "bill" ? "consBill" : "consKwh");
    if (el.name === "size") { edited.delete("price"); edited.delete("a_power"); }
    if (el.id === "province") edited.delete("exportPrice");
    schedule();
  });
  window.addEventListener("resize", schedule);
  await update();
}

main().catch((e) => { $("verdict").textContent = `Could not load the data: ${e}`; });
