import { describe, expect, it, vi } from "vitest";
import { runBacktestCommand } from "./run-command.js";
import type { KlineRow, TimescaleCandleFeedDeps } from "../feeds/timescale-candle-feed.js";
import type { SqlQuery } from "../results/backtest-result-writer.js";

const args = [
  "--strategy",
  "ema",
  "--symbol",
  "BTCUSDT",
  "--from",
  "2024-01-01",
  "--to",
  "2024-02-01"
];

function rows(interval = "15m"): KlineRow[] {
  const step = interval === "15m" ? 900000 : 3600000;
  const prices = [
    ...Array<number>(26).fill(100),
    ...Array<number>(8).fill(120),
    ...Array<number>(30).fill(80)
  ];
  return prices.map((price, index) => ({
    symbol: "BTCUSDT",
    interval,
    open_time: new Date(Date.UTC(2024, 0, 1) + index * step),
    close_time: new Date(Date.UTC(2024, 0, 1) + (index + 1) * step - 1),
    open: String(price),
    high: String(price),
    low: String(price),
    close: String(price),
    volume: "1",
    closed: true
  }));
}

describe("runBacktestCommand", () => {
  it("composes the real feed, EMA, broker, and metrics into a reproducible plain summary", async () => {
    const query = vi.fn<TimescaleCandleFeedDeps["query"]>().mockResolvedValue({ rows: rows() });
    const result = await runBacktestCommand(args, { query });
    expect(result).toMatchObject({
      strategy: "ema",
      symbol: "BTCUSDT",
      interval: "15m",
      from: "2024-01-01T00:00:00.000Z",
      to: "2024-02-01T00:00:00.000Z",
      fastPeriod: 12,
      slowPeriod: 26,
      quantity: "0.001",
      initialEquity: "10000",
      slippageBps: "10",
      takerFeeRate: "0.001",
      candleCount: 64,
      tradeCount: 2
    });
    expect(result.totalReturnPct).toMatch(/^-\d+\.\d{6}$/);
    expect(result.buyAndHoldReturnPct).toMatch(/^-?\d+\.\d{6}$/);
    expect(result.strategyVsBuyAndHoldPct).toMatch(/^-?\d+\.\d{6}$/);
    expect(result.maxDrawdownPct).toMatch(/^\d+\.\d{6}$/);
    expect(result.cagrPct).toMatch(/^-?\d+\.\d{6}$/);
    expect(result.sharpeRatio).toMatch(/^-?\d+\.\d{6}$/);
    expect(result.sortinoRatio).toMatch(/^-?\d+\.\d{6}$/);
    expect(result.winRatePct).toMatch(/^\d+\.\d{6}$/);
    expect(result.profitFactor).toMatch(/^\d+\.\d{6}$/);
    expect(result.exposurePct).toMatch(/^\d+\.\d{6}$/);
    expect(query.mock.calls[0]?.[1]).toEqual([
      "BTCUSDT",
      "15m",
      new Date("2024-01-01T00:00:00Z"),
      new Date("2024-02-01T00:00:00Z")
    ]);
    const second = await runBacktestCommand(args, { query });
    expect(JSON.stringify(second)).toBe(JSON.stringify(result));
  });

  it("passes the requested hourly interval to the database and strategy", async () => {
    const query = vi.fn<TimescaleCandleFeedDeps["query"]>().mockResolvedValue({ rows: rows("1h") });
    const result = await runBacktestCommand([...args, "--interval", "1h"], { query });
    expect(result.interval).toBe("1h");
    expect(result.tradeCount).toBe(2);
    expect(query.mock.calls[0]?.[1]?.[1]).toBe("1h");
  });

  it("persists a saved run and returns its run id", async () => {
    const query = vi.fn<TimescaleCandleFeedDeps["query"]>().mockResolvedValue({ rows: rows() });
    const execute = vi.fn<(query: SqlQuery) => Promise<void>>().mockResolvedValue(undefined);

    const result = await runBacktestCommand([...args, "--save-run", "--run-id", "manual-run"], {
      query,
      execute
    });

    expect(result.runId).toBe("manual-run");
    expect(execute.mock.calls[0]?.[0].text).toContain("INSERT INTO backtest_runs");
    expect(execute.mock.calls[0]?.[0].values.slice(0, 6)).toEqual([
      "manual-run",
      "ema",
      "BTCUSDT",
      "15m",
      Date.UTC(2024, 0, 1),
      Date.UTC(2024, 1, 1)
    ]);
    expect(JSON.parse(String(execute.mock.calls[0]?.[0].values[6]))).toEqual({
      fastPeriod: 12,
      slowPeriod: 26,
      quantity: "0.001",
      initialEquity: "10000",
      slippageBps: "10",
      takerFeeRate: "0.001"
    });
  });

  it("generates a run id when saving without an explicit id", async () => {
    const query = vi.fn<TimescaleCandleFeedDeps["query"]>().mockResolvedValue({ rows: rows() });
    const execute = vi.fn<(query: SqlQuery) => Promise<void>>().mockResolvedValue(undefined);

    const result = await runBacktestCommand([...args, "--save-run"], {
      query,
      execute,
      nowMs: () => Date.UTC(2024, 2, 1, 2, 3, 4, 5)
    });

    expect(result.runId).toBe("ema:BTCUSDT:15m:2024-03-01T02-03-04-005Z");
  });

  it("requires a SQL executor before saving a run", async () => {
    const query = vi.fn<TimescaleCandleFeedDeps["query"]>().mockResolvedValue({ rows: rows() });

    await expect(runBacktestCommand([...args, "--save-run"], { query })).rejects.toThrow(
      "Saving backtest runs requires a SQL executor"
    );
  });

  it("validates arguments before querying the database", async () => {
    const query = vi.fn<TimescaleCandleFeedDeps["query"]>();
    await expect(runBacktestCommand([], { query })).rejects.toThrow(
      "Dates must use YYYY-MM-DD in UTC"
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects empty history instead of reporting fabricated results", async () => {
    const query = vi.fn<TimescaleCandleFeedDeps["query"]>().mockResolvedValue({ rows: [] });
    await expect(runBacktestCommand(args, { query })).rejects.toThrow(
      "No candles found for requested backtest"
    );
  });

  it("propagates database failures", async () => {
    const error = new Error("database unavailable");
    const query = vi.fn<TimescaleCandleFeedDeps["query"]>().mockRejectedValue(error);
    await expect(runBacktestCommand(args, { query })).rejects.toBe(error);
  });
});
