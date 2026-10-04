import { describe, expect, it } from "vitest";
import { Decimal } from "@meridian/core";
import { calculateBacktestMetrics } from "./backtest-metrics.js";

function metrics(values: string[], initial = "1000", trades = 2) {
  return calculateBacktestMetrics(
    new Decimal(initial),
    values.map((value) => new Decimal(value)),
    trades
  );
}

describe("calculateBacktestMetrics", () => {
  it("calculates return and drawdown against the previous peak", () => {
    const result = metrics(["1250", "1000", "1500", "1200", "1300"], "1000", 4);
    expect(result.totalReturnPct.toString()).toBe("30");
    expect(result.maxDrawdownPct.toString()).toBe("20");
    expect(result.tradeCount).toBe(4);
  });

  it("includes starting capital as a peak when fees cause an immediate loss", () => {
    const result = metrics(["900", "800", "850"]);
    expect(result.totalReturnPct.toString()).toBe("-15");
    expect(result.maxDrawdownPct.toString()).toBe("20");
  });

  it("retains an earlier drawdown after equity recovers to a new high", () => {
    const result = metrics(["800", "1200", "1140"]);
    expect(result.totalReturnPct.toString()).toBe("14");
    expect(result.maxDrawdownPct.toString()).toBe("20");
  });

  it("reports no drawdown for a steadily increasing curve", () => {
    const result = metrics(["1000", "1100", "1200"]);
    expect(result.totalReturnPct.toString()).toBe("20");
    expect(result.maxDrawdownPct.isZero()).toBe(true);
  });

  it("handles a flat or empty curve", () => {
    for (const values of [[], ["1000", "1000"]]) {
      const result = metrics(values, "1000", 0);
      expect(result.totalReturnPct.isZero()).toBe(true);
      expect(result.maxDrawdownPct.isZero()).toBe(true);
      expect(result.tradeCount).toBe(0);
    }
  });

  it("supports a total loss without dividing by zero", () => {
    const result = metrics(["0"]);
    expect(result.totalReturnPct.toString()).toBe("-100");
    expect(result.maxDrawdownPct.toString()).toBe("100");
  });

  it("keeps fractional equity arithmetic decimal-safe", () => {
    const result = metrics(["0.33", "0.297"], "0.3");
    expect(result.totalReturnPct.toString()).toBe("-1");
    expect(result.maxDrawdownPct.toString()).toBe("10");
  });

  it.each(["0", "-1", "NaN", "Infinity"])("rejects invalid initial equity %s", (initial) => {
    expect(() => metrics([], initial)).toThrow("Initial equity must be finite and positive");
  });

  it.each(["-1", "NaN", "Infinity", "-Infinity"])("rejects invalid curve equity %s", (value) => {
    expect(() => metrics([value])).toThrow("Equity must be finite and non-negative");
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid trade count %s",
    (trades) => {
      expect(() => metrics([], "1000", trades)).toThrow(
        "Trade count must be a non-negative integer"
      );
    }
  );
});
