import { describe, expect, it } from "vitest";
import fx from "./fixtures/xcheck.json";
import { IEE, IVA, indexedPreTax, period, period20, period30, withTaxes } from "../src/tariffs";

describe("tariff periods and prices match the Python calculator (spain-negative-price-alert)", () => {
  it("has the calculator's assumptions", () => {
    expect(fx.assumptions.loss_factor).toBe(0.16);
    expect(fx.assumptions.adjustment_services_eur_mwh).toBe(28);
    expect(fx.assumptions.retailer_margin_eur_mwh).toBe(10);
    expect(fx.assumptions.iee).toBe(IEE);
    expect(fx.assumptions.iva).toBe(IVA);
  });
  for (const t of ["2.0TD", "3.0TD"] as const) {
    it(`${t}: ${fx.cases.length} hours agree on period, pre-tax and taxed price`, () => {
      for (const c of fx.cases) {
        const ref = (c as Record<string, unknown>)[t] as { period: number; pre_tax: number; estimate: number };
        const p = period(t, c.month, c.day, c.dow, c.hour);
        expect(p, JSON.stringify(c)).toBe(ref.period);
        const pre = indexedPreTax(t, p, c.omie);
        expect(pre).toBeCloseTo(ref.pre_tax, 10);
        expect(withTaxes(pre, true)).toBeCloseTo(ref.estimate, 10);
      }
    });
  }
  it("known periods", () => {
    expect(period20(7, 15, 2, 13)).toBe(1); // Wednesday 13:00 punta
    expect(period20(7, 15, 2, 9)).toBe(2);
    expect(period20(7, 15, 2, 3)).toBe(3);
    expect(period20(1, 6, 1, 12)).toBe(3); // Reyes
    expect(period30(7, 15, 2, 10)).toBe(1); // July = season A
    expect(period30(4, 15, 2, 10)).toBe(4); // April = season C
    expect(period30(4, 15, 2, 15)).toBe(5);
    expect(period30(4, 18, 5, 12)).toBe(6); // Saturday
  });
});
