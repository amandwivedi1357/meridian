import { describe, expect, it, vi } from "vitest";
import {
  parseBacktestResultsArgs,
  runBacktestResultsCommand
} from "./results-command.js";
import type { SqlQuery } from "../results/backtest-result-reader.js";

describe("parseBacktestResultsArgs", () => {
  it("parses list with a default and explicit limit", () => {
    expect(parseBacktestResultsArgs(["list"])).toEqual({ command: "list", limit: 20 });
    expect(parseBacktestResultsArgs(["list", "--limit", "5"])).toEqual({
      command: "list",
      limit: 5
    });
  });

  it("parses show by run id", () => {
    expect(parseBacktestResultsArgs(["show", "--run-id", "run-1"])).toEqual({
      command: "show",
      runId: "run-1"
    });
  });

  it.each([
    { args: [""] },
    { args: ["delete"] },
    { args: ["list", "--run-id", "x"] },
    { args: ["show"] },
    { args: ["show", "--limit", "2"] }
  ])(
    "rejects unsupported result command %j",
    ({ args }) => {
      expect(() => parseBacktestResultsArgs(args)).toThrow();
    }
  );
});

describe("runBacktestResultsCommand", () => {
  it("lists saved runs as plain CLI output", async () => {
    const query = vi.fn<(query: SqlQuery) => Promise<{ rows: readonly Record<string, unknown>[] }>>();
    query.mockResolvedValue({
      rows: [
        {
          run_id: "run-1",
          strategy: "ema",
          symbol: "BTCUSDT",
          interval: "15m",
          from_ms: 1704067200000,
          to_ms: 1704153600000,
          metrics: { totalReturnPct: "1.23", tradeCount: 2 },
          created_at: new Date("2024-01-03T00:00:00Z")
        }
      ]
    });

    await expect(runBacktestResultsCommand(["list", "--limit", "1"], { query })).resolves.toEqual({
      runs: [
        {
          runId: "run-1",
          strategy: "ema",
          symbol: "BTCUSDT",
          interval: "15m",
          from: "2024-01-01T00:00:00.000Z",
          to: "2024-01-02T00:00:00.000Z",
          createdAt: "2024-01-03T00:00:00.000Z",
          totalReturnPct: "1.23",
          tradeCount: 2
        }
      ]
    });
  });

  it("shows a saved run report summary with fills", async () => {
    const query = vi.fn<(query: SqlQuery) => Promise<{ rows: readonly Record<string, unknown>[] }>>();
    query
      .mockResolvedValueOnce({
        rows: [
          {
            run_id: "run-1",
            strategy: "ema",
            symbol: "BTCUSDT",
            interval: "15m",
            from_ms: 1704067200000,
            to_ms: 1704153600000,
            params: { quantity: "0.001" },
            metrics: { totalReturnPct: "1.23", tradeCount: 1 },
            created_at: new Date("2024-01-03T00:00:00Z")
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
          { point_index: 1, ts_ms: 1704074400000, equity: "10010" }
        ]
      });

    await expect(runBacktestResultsCommand(["show", "--run-id", "run-1"], { query })).resolves.toMatchObject({
      runId: "run-1",
      params: { quantity: "0.001" },
      metrics: { totalReturnPct: "1.23", tradeCount: 1 },
      fillCount: 1,
      equityPointCount: 2,
      firstEquity: { ts: "2024-01-01T01:00:00.000Z", equity: "10000" },
      lastEquity: { ts: "2024-01-01T02:00:00.000Z", equity: "10010" },
      fills: [
        {
          index: 0,
          side: "BUY",
          quantity: "0.001",
          price: "50000"
        }
      ]
    });
  });
});
