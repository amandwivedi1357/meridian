import { describe, expect, it, vi } from "vitest";
import { runBacktestCommand } from "./run-command.js";
import type { KlineRow, TimescaleCandleFeedDeps } from "../feeds/timescale-candle-feed.js";

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
    expect(result.maxDrawdownPct).toMatch(/^\d+\.\d{6}$/);
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
