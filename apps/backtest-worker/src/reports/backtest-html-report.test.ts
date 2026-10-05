import { describe, expect, it } from "vitest";
import { renderBacktestHtmlReport } from "./backtest-html-report.js";
import type { SavedBacktestRunReport } from "../results/backtest-result-reader.js";

function report(override: Partial<SavedBacktestRunReport> = {}): SavedBacktestRunReport {
  return {
    runId: "ema-btc-jan-2024",
    strategy: "ema",
    symbol: "BTCUSDT",
    interval: "15m",
    fromMs: 1704067200000,
    toMs: 1704153600000,
    createdAt: "2024-01-02T00:00:00.000Z",
    params: { fastPeriod: 12, slowPeriod: 26 },
    metrics: {
      totalReturnPct: "1.23",
      buyAndHoldReturnPct: "0.75",
      maxDrawdownPct: "0.50",
      tradeCount: 2,
      cagrPct: "2.34",
      sharpeRatio: "1.10",
      winRatePct: "50",
      exposurePct: "25"
    },
    fills: [
      {
        index: 0,
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: "0.001",
        price: "50000",
        fee: "0.05",
        feeAsset: "USDT",
        tsMs: 1704070800000
      }
    ],
    equityCurve: [
      { index: 0, tsMs: 1704070800000, equity: "10000" },
      { index: 1, tsMs: 1704074400000, equity: "10020" },
      { index: 2, tsMs: 1704078000000, equity: "10010" }
    ],
    ...override
  };
}

describe("renderBacktestHtmlReport", () => {
  it("renders key report sections and chart SVGs", () => {
    const html = renderBacktestHtmlReport(report());

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Backtest report");
    expect(html).toContain("ema-btc-jan-2024");
    expect(html).toContain("Total return");
    expect(html).toContain("Equity curve");
    expect(html).toContain("Drawdown");
    expect(html).toContain("Parameters");
    expect(html).toContain("Fills");
    expect(html).toContain("<svg");
    expect(html).toContain("0.001");
  });

  it("escapes stored values before writing HTML", () => {
    const html = renderBacktestHtmlReport(
      report({
        runId: "<script>alert(1)</script>",
        params: { note: "<img src=x onerror=alert(1)>" }
      })
    );

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("renders empty states when fills and equity are absent", () => {
    const html = renderBacktestHtmlReport(report({ fills: [], equityCurve: [] }));

    expect(html).toContain("No equity points recorded.");
    expect(html).toContain("No drawdown points recorded.");
    expect(html).toContain("No fills recorded.");
  });
});
