import { describe, expect, it } from "vitest";
import { planDay, simulate, type Battery, type Hourly } from "../src/dispatch";

function day(load: number[], solar: number[], price: number[], days = 1): Hourly {
  const L: number[] = [], S: number[] = [], P: number[] = [], H: number[] = [];
  for (let d = 0; d < days; d++)
    for (let h = 0; h < 24; h++) { L.push(load[h]); S.push(solar[h]); P.push(price[h]); H.push(h); }
  return { load: Float64Array.from(L), solar: Float64Array.from(S), price: Float64Array.from(P), hour: Uint8Array.from(H) };
}
const flat = (v: number) => Array(24).fill(v);
const sunny = Array.from({ length: 24 }, (_, h) => (h >= 9 && h < 17 ? 2 : 0)); // 16 kWh/day
const bat = (o: Partial<Battery> = {}): Battery => ({ capacityKwh: 5, powerKw: 2.5, roundTrip: 0.9, gridCharge: false, ...o });

describe("dispatch", () => {
  it("no battery: import = max(0, load-solar), export = max(0, solar-load)", () => {
    const f = simulate(day(flat(0.5), sunny, flat(0.1)), null);
    expect(f.imp.reduce((a, b) => a + b)).toBeCloseTo(16 * 0.5, 9);
    expect(f.exp.reduce((a, b) => a + b)).toBeCloseTo(8 * 1.5, 9);
  });
  it("energy balance holds every hour, SOC stays in [0, capacity]", () => {
    const h = day(flat(0.5), sunny, flat(0.1), 3);
    const b = bat();
    const f = simulate(h, b);
    const eta = Math.sqrt(0.9);
    let prev = 0;
    for (let i = 0; i < h.load.length; i++) {
      expect(f.soc[i]).toBeGreaterThanOrEqual(-1e-12);
      expect(f.soc[i]).toBeLessThanOrEqual(b.capacityKwh + 1e-12);
      const dSoc = f.soc[i] - prev;
      const batteryIn = dSoc > 0 ? dSoc / eta : dSoc * eta; // grid-side kWh into the battery
      // solar + import = load + export + battery charging (negative when discharging)
      expect(h.solar[i] + f.imp[i]).toBeCloseTo(h.load[i] + f.exp[i] + batteryIn, 9);
      prev = f.soc[i];
    }
  });
  it("round-trip efficiency: 5 kWh stored delivers 5*sqrt(0.9) kWh", () => {
    const h = day(flat(0.5), sunny, flat(0.1), 2);
    const f = simulate(h, bat());
    // day 1 fills to 5 kWh (12 kWh surplus), the evening/night drains it
    expect(Math.max(...f.soc)).toBeCloseTo(5, 9);
    const delivered = f.discharged;
    expect(delivered).toBeGreaterThan(0);
    // over 2 days the battery delivers at most what solar put in times the round trip
    const charged = 2 * 5; // filled twice
    expect(delivered).toBeLessThanOrEqual(charged * Math.sqrt(0.9) + 1e-9);
  });
  it("power limit caps charging per hour", () => {
    const f = simulate(day(flat(0), flat(10), flat(0.1)), bat({ capacityKwh: 100, powerKw: 2 }));
    expect(f.soc[0]).toBeCloseTo(2 * Math.sqrt(0.9), 9);
  });
  it("grid charging: buys the evening deficit in the cheapest night hours when it pays", () => {
    const price = Array.from({ length: 24 }, (_, h) => (h < 8 ? (h === 3 || h === 4 ? 0.05 : 0.08) : 0.25));
    const load = Array.from({ length: 24 }, (_, h) => (h >= 18 && h < 22 ? 1 : 0)); // 4 kWh evening
    const h = day(load, flat(0), price);
    const b = bat({ gridCharge: true, powerKw: 2.5 });
    const plan = planDay(h, 0, 0, b);
    expect([...plan.keys()].sort()).toEqual([3, 4]); // two cheapest hours suffice (2.5 kW each)
    const stored = [...plan.values()].reduce((a, v) => a + v, 0) * Math.sqrt(0.9);
    expect(stored).toBeCloseTo(4 / Math.sqrt(0.9), 9);
    const f = simulate(h, b);
    expect(f.imp.slice(18, 22).reduce((a, v) => a + v, 0)).toBeCloseTo(0, 9);
  });
  it("grid charging does not buy when night power is not cheaper after losses", () => {
    const price = Array.from({ length: 24 }, (_, h) => (h < 8 ? 0.2 : 0.21));
    const load = Array.from({ length: 24 }, (_, h) => (h >= 18 && h < 22 ? 1 : 0));
    expect(planDay(day(load, flat(0), price), 0, 0, bat({ gridCharge: true })).size).toBe(0);
  });
  it("grid charging accounts for solar that will refill the battery", () => {
    const price = Array.from({ length: 24 }, (_, h) => (h < 8 ? 0.05 : 0.25));
    const load = Array.from({ length: 24 }, (_, h) => (h >= 18 && h < 22 ? 1 : 0));
    // 16 kWh of solar surplus later in the day covers the 4 kWh evening: nothing to buy
    expect(planDay(day(load, sunny, price), 0, 0, bat({ gridCharge: true })).size).toBe(0);
  });
});
