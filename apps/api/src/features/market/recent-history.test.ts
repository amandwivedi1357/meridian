import { describe, expect, it, vi } from "vitest";
import { createRecentHistoryLoader, parseRecentHistory } from "./recent-history.js";

const step = 900000,
  end = step * 100 - 1;
const row = (open: number) => [
  open,
  "100",
  "102",
  "99",
  "101",
  "12",
  open + step - 1,
  "1200",
  5,
  "6",
  "600",
  "0"
];
const rows = () => [row(step * 98), row(step * 99)];
describe("recent public chart history", () => {
  it("uses exact string prices and only contiguous closed candles", () => {
    expect(parseRecentHistory(rows(), "BTCUSDT", "15m", end)).toMatchObject([
      { open: "100", closed: true },
      { close: "101", closeTimeMs: end }
    ]);
  });
  it("rejects old, duplicate, gapped, future and malformed candles", () => {
    expect(() => parseRecentHistory([row(0)], "BTCUSDT", "15m", end)).toThrow(
      "stale_chart_history"
    );
    expect(() =>
      parseRecentHistory([row(step * 98), row(step * 98)], "BTCUSDT", "15m", end)
    ).toThrow();
    expect(() =>
      parseRecentHistory([row(step * 97), row(step * 99)], "BTCUSDT", "15m", end)
    ).toThrow();
    expect(() => parseRecentHistory([row(step * 100)], "BTCUSDT", "15m", end)).toThrow();
    const invalid = row(step * 99);
    invalid[4] = "103";
    expect(() => parseRecentHistory([invalid], "BTCUSDT", "15m", end)).toThrow(
      "invalid_chart_history_ohlc"
    );
    expect(() => parseRecentHistory([], "BTCUSDT", "15m", end)).toThrow();
  });
  it("coalesces requests, caches briefly and refreshes at the candle boundary", async () => {
    let now = end + 1;
    const fetch = vi.fn(async (_symbol: string, _interval: string, until: number) => [
      row(until - step + 1)
    ]);
    const load = createRecentHistoryLoader(fetch, () => now);
    const [a, b] = await Promise.all([load("BTCUSDT", "15m"), load("BTCUSDT", "15m")]);
    expect(a).toEqual(b);
    expect(fetch).toHaveBeenCalledTimes(1);
    now += 1000;
    await load("BTCUSDT", "15m");
    expect(fetch).toHaveBeenCalledTimes(1);
    now += step;
    await load("BTCUSDT", "15m");
    expect(fetch).toHaveBeenCalledTimes(2);
    now += 31000;
    await load("BTCUSDT", "15m");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("does not cache exchange failures", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(rows());
    const load = createRecentHistoryLoader(fetch, () => end + 1);
    await expect(load("BTCUSDT", "15m")).rejects.toThrow("offline");
    expect(await load("BTCUSDT", "15m")).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
