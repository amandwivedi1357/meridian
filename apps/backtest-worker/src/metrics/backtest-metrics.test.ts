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
    expect(result.buyAndHoldReturnPct.toString()).toBe("0");
    expect(result.strategyVsBuyAndHoldPct.toString()).toBe("30");
    expect(result.cagrPct.toString()).toBe("30");
    expect(result.sharpeRatio.toDecimalPlaces(6).toString()).toBe("0.322144");
    expect(result.sortinoRatio.toDecimalPlaces(6).toString()).toBe("0.433333");
    expect(result.winRatePct.toString()).toBe("0");
    expect(result.profitFactor.toString()).toBe("0");
    expect(result.exposurePct.toString()).toBe("0");
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

  it("calculates CAGR from the requested time range", () => {
    const result = calculateBacktestMetrics(new Decimal(1000), [new Decimal(1210)], 0, {
      fromMs: Date.UTC(2024, 0, 1),
      toMs: Date.UTC(2026, 0, 1)
    });

    expect(result.totalReturnPct.toString()).toBe("21");
    expect(result.cagrPct.toDecimalPlaces(6).toString()).toBe("9.992829");
  });

  it("calculates Sharpe and Sortino from equity-period returns", () => {
    const result = calculateBacktestMetrics(
      new Decimal(100),
      [new Decimal(110), new Decimal(105), new Decimal(120)],
      0,
      { periodsPerYear: 1 }
    );

    expect(result.sharpeRatio.toDecimalPlaces(6).toString()).toBe("0.816473");
    expect(result.sortinoRatio.toDecimalPlaces(6).toString()).toBe("1.447619");
  });

  it("calculates win rate, profit factor, and exposure from optional run stats", () => {
    const result = calculateBacktestMetrics(new Decimal(1000), [new Decimal(1100)], 3, {
      closedTradePnls: [new Decimal(20), new Decimal("-5"), new Decimal(0)],
      exposureBars: 2,
      totalBars: 5
    });

    expect(result.winRatePct.toString()).toBe("33.333333333333333333");
    expect(result.profitFactor.toString()).toBe("4");
    expect(result.exposurePct.toString()).toBe("40");
  });

  it("compares strategy return against buy-and-hold return", () => {
    const result = calculateBacktestMetrics(new Decimal(1000), [new Decimal(1150)], 0, {
      buyAndHoldReturnPct: new Decimal(20)
    });

    expect(result.totalReturnPct.toString()).toBe("15");
    expect(result.buyAndHoldReturnPct.toString()).toBe("20");
    expect(result.strategyVsBuyAndHoldPct.toString()).toBe("-5");
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

  it("rejects invalid optional metric inputs", () => {
    expect(() =>
      calculateBacktestMetrics(new Decimal(1000), [], 0, {
        closedTradePnls: [new Decimal("NaN")]
      })
    ).toThrow("Closed trade PnL must be finite");

    expect(() =>
      calculateBacktestMetrics(new Decimal(1000), [], 0, {
        exposureBars: 2,
        totalBars: 1
      })
    ).toThrow("Exposure bars must be between 0 and total bars");

    expect(() =>
      calculateBacktestMetrics(new Decimal(1000), [], 0, {
        fromMs: 2,
        toMs: 1
      })
    ).toThrow("Metric time range must be increasing");

    expect(() =>
      calculateBacktestMetrics(new Decimal(1000), [], 0, {
        buyAndHoldReturnPct: new Decimal("NaN")
      })
    ).toThrow("Buy-and-hold return must be finite");
  });
});
