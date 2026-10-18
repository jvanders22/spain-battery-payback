import * as Plot from "@observablehq/plot";
import type { Result, YearData } from "./model";

export interface DayProfile {
  hour: number;
  load: number;
  solar: number;
  soc: number;
  price: number; // c/kWh before taxes
}

/** Average hourly profile over every day of `month` (local time). */
export function typicalDay(y: YearData, r: Result, month: number): DayProfile[] {
  const acc = Array.from({ length: 24 }, (_, hour) => ({ hour, load: 0, solar: 0, soc: 0, price: 0, n: 0 }));
  for (let i = 0; i < y.hour.length; i++) {
    if (y.month[i] !== month) continue;
    const a = acc[y.hour[i]];
    a.load += r.hourly.load[i];
    a.solar += r.hourly.solar[i];
    a.soc += r.flows.soc[i];
    a.price += r.hourly.price[i] * 100;
    a.n++;
  }
  return acc.map(({ n, ...a }) => ({ hour: a.hour, load: a.load / n, solar: a.solar / n, soc: a.soc / n, price: a.price / n }));
}

const FONT = '"Source Sans 3", "Helvetica Neue", Arial, sans-serif';
const SOLAR = "#c58a00";
const SOC = "#7d8a96";

function energyPlot(d: DayProfile[], width: number, yMax: number) {
  const last = d[d.length - 1];
  const peakSolar = d.reduce((a, b) => (b.solar > a.solar ? b : a));
  const peakSoc = d.reduce((a, b) => (b.soc > a.soc ? b : a));
  return Plot.plot({
    width, height: 230, marginLeft: 38, marginRight: 70, marginTop: 22,
    style: { fontFamily: FONT, fontSize: "12px", background: "transparent", color: "#1b1b1b" },
    x: { domain: [0, 23], ticks: [0, 6, 12, 18, 23], tickFormat: (h: number) => `${String(h).padStart(2, "0")}:00`, label: null },
    y: { domain: [0, yMax], label: "kWh per hour", grid: true, nice: true },
    marks: [
      Plot.areaY(d, { x: "hour", y: "soc", fill: SOC, fillOpacity: 0.18, curve: "monotone-x" }),
      Plot.line(d, { x: "hour", y: "soc", stroke: SOC, strokeDasharray: "3,2", curve: "monotone-x" }),
      Plot.line(d, { x: "hour", y: "solar", stroke: SOLAR, strokeWidth: 2.2, curve: "monotone-x" }),
      Plot.line(d, { x: "hour", y: "load", stroke: "#1b1b1b", strokeWidth: 2.2, curve: "monotone-x" }),
      Plot.text([last], { x: "hour", y: "load", text: () => "Your load", dx: 6, textAnchor: "start", fill: "#1b1b1b" }),
      Plot.text([peakSolar].filter((p) => p.solar > 0.05), { x: "hour", y: "solar", text: () => "Solar", dy: -8, fill: SOLAR, fontWeight: 600 }),
      Plot.text([peakSoc].filter((p) => p.soc > 0.05), { x: "hour", y: "soc", text: (p: DayProfile) => `Battery ${p.soc.toFixed(1)} kWh stored`, dy: -8, dx: 4, textAnchor: "start", fill: "#4f5a64" }),
    ],
  });
}

function pricePlot(d: DayProfile[], width: number, pMax: number) {
  const hi = d.reduce((a, b) => (b.price > a.price ? b : a));
  const lo = d.reduce((a, b) => (b.price < a.price ? b : a));
  return Plot.plot({
    width, height: 110, marginLeft: 38, marginRight: 70, marginTop: 14,
    style: { fontFamily: FONT, fontSize: "12px", background: "transparent", color: "#1b1b1b" },
    x: { domain: [0, 23], ticks: [0, 6, 12, 18, 23], tickFormat: (h: number) => `${String(h).padStart(2, "0")}:00`, label: null },
    y: { domain: [0, pMax], label: "c/kWh", grid: true, nice: true, ticks: 3 },
    marks: [
      Plot.line(d, { x: "hour", y: "price", stroke: "#b8461b", strokeWidth: 1.8, curve: "step-after" }),
      Plot.text([hi], { x: "hour", y: "price", text: (p: DayProfile) => `${p.price.toFixed(1)} c`, dy: -7, fill: "#b8461b" }),
      Plot.text(hi.hour !== lo.hour ? [lo] : [], { x: "hour", y: "price", text: (p: DayProfile) => `${p.price.toFixed(1)} c`, dy: 11, fill: "#5c5a55" }),
    ],
  });
}

export function render(el: HTMLElement, y: YearData, r: Result): string {
  const summer = typicalDay(y, r, 7);
  const winter = typicalDay(y, r, 1);
  const width = Math.min(el.clientWidth || 640, 680);
  const all = [...summer, ...winter];
  const yMax = Math.max(0.5, ...all.map((p) => Math.max(p.load, p.solar, p.soc)));
  const pMax = Math.max(1, ...all.map((p) => p.price));
  el.replaceChildren();
  for (const [d, title] of [[summer, "July"], [winter, "January"]] as const) {
    const wrap = document.createElement("div");
    const pic = document.createElement("div");
    pic.setAttribute("role", "img");
    const sum = (k: keyof DayProfile) => d.reduce((a, p) => a + (p[k] as number), 0);
    const label = `${title}, average day: load ${sum("load").toFixed(1)} kWh, solar ${sum("solar").toFixed(1)} kWh, battery holds up to ${Math.max(...d.map((p) => p.soc)).toFixed(1)} kWh; price before taxes from ${Math.min(...d.map((p) => p.price)).toFixed(1)} to ${Math.max(...d.map((p) => p.price)).toFixed(1)} c/kWh.`;
    pic.setAttribute("aria-label", label);
    const h = document.createElement("h3");
    h.className = "panel";
    h.textContent = `${title}: an average day`;
    const note = document.createElement("p");
    note.className = "panel-note";
    note.textContent = "Price you pay per kWh before taxes";
    const e = energyPlot(d, width, yMax);
    const p = pricePlot(d, width, pMax);
    e.setAttribute("aria-hidden", "true");
    p.setAttribute("aria-hidden", "true");
    note.setAttribute("aria-hidden", "true");
    pic.append(e, note, p);
    wrap.append(h, pic);
    el.append(wrap);
  }
  return "";
}
