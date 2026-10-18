// Battery prices: installed, turnkey, IVA included (homes). ESTIMATES quoted as ranges from the pages
// below (all read 18 Oct 2026). The default is a round number near the middle of the overlap.
export const BATTERY_SIZES = [5, 10, 15] as const;
export type Size = (typeof BATTERY_SIZES)[number];

export const BATTERY_PRICE: Record<Size, { default: number; low: number; high: number; powerKw: number }> = {
  5: { default: 4000, low: 2500, high: 5500, powerKw: 3 },
  10: { default: 7000, low: 5000, high: 11000, powerKw: 5 },
  15: { default: 9500, low: 7500, high: 13000, powerKw: 6 },
};

export const PRICE_SOURCES = [
  {
    name: "SolarPlan, storage price index (Spain, homes, turnkey incl. IVA)",
    url: "https://solarplan.app/es/solar/spain/storage",
    date: "prices dated 4 Oct 2026",
    quote: "5 kWh / 3.6 kW: €3,500–5,500; 10 kWh / 5 kW: €7,000–11,000; 15 kWh / 6 kW: €8,000–12,800",
  },
  {
    name: "Solar Daurada (installer, Tarragona), Precio de una batería solar en 2026",
    url: "https://www.solardaurada.es/blog/precio-bateria-solar/",
    date: "2026",
    quote: "5 kWh: €2,800–4,500; 10 kWh: €5,000–8,500; 15 kWh: €8,000–13,000 (LFP, installed)",
  },
  {
    name: "GuíaSolares, Precio batería solar instalada 2026 (quotes Yosol, installer, Sep 2026, and SunFields, distributor, Aug 2026)",
    url: "https://guiasolares.es/bateria-solar-precio-instalada/",
    date: "Sep 2026",
    quote: "Yosol: 5 kWh €2,500–3,500; 10 kWh €5,500–7,500; 15 kWh from €8,000. SunFields: €500–950/kWh installed",
  },
];

export const ASSUMPTIONS = {
  roundTrip: { value: 0.9, note: "ASSUMPTION. Round-trip efficiency of a home LFP battery with hybrid inverter, about 90 %." },
  usableShare: { value: 0.95, note: "ASSUMPTION. Usable share of nominal capacity (LFP, typical depth of discharge 95 %)." },
  degradation: { value: 0.02, note: "ASSUMPTION. Capacity loss 2 % per year (warranties typically guarantee 60–70 % after 10 years)." },
  billEnergyShare: { value: 0.7, note: "ASSUMPTION. Share of a monthly bill that is energy (the rest is power term, meter, taxes on those). Only used when you enter a bill instead of kWh." },
};

export const IRPF = {
  note: "IRPF deduction for self-consumption installations, which may include storage: 10 % of the amount paid in 2026 (base max €5,000/yr, so max €500), homes only, installation finished and paid by card or transfer in 2026, with CIE. Not for installations used in a business.",
  url: "https://www.boe.es/buscar/act.php?id=BOE-A-2006-20764",
  ref: "Ley 35/2006 (IRPF), disposición adicional sexagésima segunda, added by Real Decreto-ley 7/2026 (BOE-A-2026-6544)",
};
