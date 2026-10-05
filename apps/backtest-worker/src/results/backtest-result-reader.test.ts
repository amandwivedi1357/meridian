import { describe, expect, it, vi } from "vitest";
import { createBacktestResultReader, type SqlQuery } from "./backtest-result-reader.js";

function setup(rows: readonly Record<string, unknown>[] = []) {
  const query = vi.fn<(query: SqlQuery) => Promise<{ rows: readonly Record<string, unknown>[] }>>();
  query.mockResolvedValue({ rows });
  return {
    query,
    reader: createBacktestResultReader({ query })
  };
}

describe("backtest result reader", () => {
  it("lists recent saved runs in database order", async () => {
    const { query, reader } = setup([
      {
        run_id: "run-2",
        strategy: "ema",
        symbol: "BTCUSDT",
        interval: "15m",
        from_ms: "1704067200000",
        to_ms: "1704153600000",
        metrics: { totalReturnPct: "1.23", tradeCount: 2 },
        created_at: new Date("2024-01-02T00:00:00Z")
      }
    ]);

    await expect(reader.listRecent(10)).resolves.toEqual([
      {
        runId: "run-2",
        strategy: "ema",
        symbol: "BTCUSDT",
        interval: "15m",
        fromMs: 1704067200000,
        toMs: 1704153600000,
        metrics: { totalReturnPct: "1.23", tradeCount: 2 },
        createdAt: "2024-01-02T00:00:00.000Z"
      }
    ]);
    expect(query.mock.calls[0]?.[0].text).toContain("FROM backtest_runs");
    expect(query.mock.calls[0]?.[0].values).toEqual([10]);
  });

  it.each([0, 101, 1.5])("rejects invalid list limit %s", async (limit) => {
    const { reader } = setup();
    await expect(reader.listRecent(limit)).rejects.toThrow(
      "Backtest run list limit must be between 1 and 100"
    );
  });

  it("loads a saved run report with fills and equity curve", async () => {
    const query = vi.fn<(query: SqlQuery) => Promise<{ rows: readonly Record<string, unknown>[] }>>();
    query
      .mockResolvedValueOnce({
        rows: [
          {
            run_id: "run-1",
            strategy: "ema",
            symbol: "BTCUSDT",
            interval: "1h",
            from_ms: 1704067200000,
            to_ms: 1704153600000,
            params: JSON.stringify({ fastPeriod: 12, slowPeriod: 26 }),
            metrics: JSON.stringify({ totalReturnPct: "-0.1", tradeCount: 1 }),
            created_at: "2024-01-02T00:00:00Z"
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            fill_index: 0,
            symbol: "BTCUSDT",
            side: "BUY",
            quantity: "0.001",
            price: "50000",
            fee: "0.05",
            fee_asset: "USDT",
            ts_ms: 1704070800000
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          { point_index: 0, ts_ms: 1704070800000, equity: "10000" },
          { point_index: 1, ts_ms: 1704074400000, equity: "9990" }
        ]
      });

    await expect(createBacktestResultReader({ query }).getReport("run-1")).resolves.toEqual({
      runId: "run-1",
      strategy: "ema",
      symbol: "BTCUSDT",
      interval: "1h",
      fromMs: 1704067200000,
      toMs: 1704153600000,
      createdAt: "2024-01-02T00:00:00.000Z",
      params: { fastPeriod: 12, slowPeriod: 26 },
      metrics: { totalReturnPct: "-0.1", tradeCount: 1 },
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
        { index: 1, tsMs: 1704074400000, equity: "9990" }
      ]
    });
  });

  it("rejects missing run ids and unknown runs", async () => {
    const { reader } = setup([]);

    await expect(reader.getReport(" ")).rejects.toThrow("Backtest run id is required");
    await expect(reader.getReport("missing")).rejects.toThrow("Backtest run not found: missing");
  });
});
