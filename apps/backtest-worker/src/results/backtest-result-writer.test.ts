import { describe, expect, it, vi } from "vitest";
import { Decimal, type Fill } from "@meridian/core";
import { createBacktestResultWriter, type SqlQuery } from "./backtest-result-writer.js";
import type { BacktestMetrics } from "../metrics/backtest-metrics.js";

function metrics(): BacktestMetrics {
  return {
    totalReturnPct: new Decimal("1.23"),
    cagrPct: new Decimal("2.34"),
    maxDrawdownPct: new Decimal("0.5"),
    sharpeRatio: new Decimal("1.1"),
    sortinoRatio: new Decimal("1.2"),
    winRatePct: new Decimal("50"),
    profitFactor: new Decimal("1.7"),
    exposurePct: new Decimal("25"),
    tradeCount: 2,
    buyAndHoldReturnPct: new Decimal("0.75"),
    strategyVsBuyAndHoldPct: new Decimal("0.48")
  };
}

function fill(override: Partial<Fill> = {}): Fill {
  return {
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: new Decimal("0.01"),
    price: new Decimal("50000.12345678"),
    fee: new Decimal("0.5"),
    feeAsset: "USDT",
    tsMs: 1704067200000,
    ...override
  };
}

function setup() {
  const execute = vi.fn<(query: SqlQuery) => Promise<void>>().mockResolvedValue(undefined);
  return {
    execute,
    writer: createBacktestResultWriter({ execute })
  };
}

describe("backtest result writer", () => {
  it("saves run metadata with JSON params and decimal-safe metrics", async () => {
    const { execute, writer } = setup();

    await writer.save({
      runId: "run-1",
      strategy: "ema-crossover",
      symbol: "BTCUSDT",
      interval: "15m",
      fromMs: 1704067200000,
      toMs: 1704153600000,
      params: { fast: 12, slow: 26, quantity: "0.01" },
      metrics: metrics(),
      fills: [],
      equityCurve: []
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const runQuery = execute.mock.calls[0]?.[0];
    expect(runQuery?.text).toContain("INSERT INTO backtest_runs");
    expect(runQuery?.text).toContain("ON CONFLICT (run_id) DO UPDATE");
    expect(runQuery?.values.slice(0, 6)).toEqual([
      "run-1",
      "ema-crossover",
      "BTCUSDT",
      "15m",
      1704067200000,
      1704153600000
    ]);
    expect(JSON.parse(String(runQuery?.values[6]))).toEqual({
      fast: 12,
      slow: 26,
      quantity: "0.01"
    });
    expect(JSON.parse(String(runQuery?.values[7]))).toEqual({
      totalReturnPct: "1.23",
      cagrPct: "2.34",
      maxDrawdownPct: "0.5",
      sharpeRatio: "1.1",
      sortinoRatio: "1.2",
      winRatePct: "50",
      profitFactor: "1.7",
      exposurePct: "25",
      tradeCount: 2,
      buyAndHoldReturnPct: "0.75",
      strategyVsBuyAndHoldPct: "0.48"
    });
  });

  it("saves fills with stable indexes and decimal strings", async () => {
    const { execute, writer } = setup();

    await writer.save({
      runId: "run-2",
      strategy: "ema-crossover",
      symbol: "BTCUSDT",
      interval: "1h",
      fromMs: 1704067200000,
      toMs: 1704153600000,
      params: {},
      metrics: metrics(),
      fills: [
        fill(),
        fill({
          side: "SELL",
          quantity: new Decimal("0.005"),
          price: new Decimal("51000"),
          fee: new Decimal("0.25"),
          tsMs: 1704070800000
        })
      ],
      equityCurve: []
    });

    expect(execute).toHaveBeenCalledTimes(2);
    const fillQuery = execute.mock.calls[1]?.[0];
    expect(fillQuery?.text).toContain("INSERT INTO backtest_fills");
    expect(fillQuery?.values).toEqual([
      "run-2",
      0,
      "BTCUSDT",
      "BUY",
      "0.01",
      "50000.12345678",
      "0.5",
      "USDT",
      1704067200000,
      "run-2",
      1,
      "BTCUSDT",
      "SELL",
      "0.005",
      "51000",
      "0.25",
      "USDT",
      1704070800000
    ]);
  });

  it("saves equity curve points with stable indexes and decimal strings", async () => {
    const { execute, writer } = setup();

    await writer.save({
      runId: "run-3",
      strategy: "grid-mean-reversion",
      symbol: "BTCUSDT",
      interval: "15m",
      fromMs: 1704067200000,
      toMs: 1704153600000,
      params: {},
      metrics: metrics(),
      fills: [],
      equityCurve: [
        { tsMs: 1704067200000, equity: new Decimal("10000") },
        { tsMs: 1704068100000, equity: new Decimal("10001.23") }
      ]
    });

    expect(execute).toHaveBeenCalledTimes(2);
    const equityQuery = execute.mock.calls[1]?.[0];
    expect(equityQuery?.text).toContain("INSERT INTO backtest_equity_points");
    expect(equityQuery?.values).toEqual([
      "run-3",
      0,
      1704067200000,
      "10000",
      "run-3",
      1,
      1704068100000,
      "10001.23"
    ]);
  });

  it("rejects invalid run identity and time ranges", async () => {
    const { writer } = setup();

    await expect(
      writer.save({
        runId: " ",
        strategy: "ema-crossover",
        symbol: "BTCUSDT",
        interval: "15m",
        fromMs: 2,
        toMs: 1,
        params: {},
        metrics: metrics(),
        fills: [],
        equityCurve: []
      })
    ).rejects.toThrow("Backtest run id is required");

    await expect(
      writer.save({
        runId: "run-4",
        strategy: "ema-crossover",
        symbol: "BTCUSDT",
        interval: "15m",
        fromMs: 2,
        toMs: 1,
        params: {},
        metrics: metrics(),
        fills: [],
        equityCurve: []
      })
    ).rejects.toThrow("Backtest time range must be increasing");
  });
});
