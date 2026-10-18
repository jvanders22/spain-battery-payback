import { describe, expect, it } from "vitest";
import { bill, type YearData } from "../src/model";
import type { Flows, Hourly } from "../src/dispatch";
import { IEE, IVA } from "../src/tariffs";

describe("net billing", () => {
  const y = { month: [1, 1, 2, 2] } as unknown as YearData;
  const h: Hourly = { load: Float64Array.from([1, 1, 1, 1]), solar: new Float64Array(4), price: Float64Array.from([0.2, 0.2, 0.2, 0.2]), hour: new Uint8Array(4) };
  const flows = (imp: number[], exp: number[]): Flows => ({ imp: Float64Array.from(imp), exp: Float64Array.from(exp), soc: new Float64Array(4), gridCharged: 0, discharged: 0 });
  it("credits exports and taxes the remainder", () => {
    const b = bill(y, h, flows([1, 1, 1, 1], [1, 0, 0, 0]), 0.05, true);
    expect(b.energyCost).toBeCloseTo((0.4 - 0.05 + 0.4) * (1 + IEE) * (1 + IVA), 9);
  });
  it("caps the monthly credit at the month's energy cost", () => {
    const b = bill(y, h, flows([1, 0, 1, 1], [0, 10, 0, 0]), 0.05, true);
    expect(b.compensated).toBeCloseTo(0.2, 9);
    expect(b.lostExportValue).toBeCloseTo(0.3, 9);
    expect(b.energyCost).toBeCloseTo(0.4 * (1 + IEE) * (1 + IVA), 9);
  });
  it("business: no IVA", () => {
    const b = bill(y, h, flows([1, 1, 1, 1], [0, 0, 0, 0]), 0.05, false);
    expect(b.energyCost).toBeCloseTo(0.8 * (1 + IEE), 9);
  });
});
