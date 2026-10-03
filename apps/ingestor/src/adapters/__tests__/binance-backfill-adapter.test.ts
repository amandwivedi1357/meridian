import type { BinanceKlinesResponse } from "@meridian/binance-client";
import { describe, expect, it, vi } from "vitest";
import { createBinanceKlineBackfillFetcher } from "../binance-backfill-adapter.js";

describe("createBinanceKlineBackfillFetcher", () => {
  it("fetches Binance klines and parses them into core candles", async () => {
    const response: BinanceKlinesResponse = [
      [
        0,
        "100.10",
        "101.20",
        "99.90",
        "100.50",
        "2.25",
        59_999,
        "225.00",
        10,
        "1.00",
        "100.00",
        "0"
      ]
    ];
    const getKlines = vi.fn(async () => response);
    const fetchKlines = createBinanceKlineBackfillFetcher({ getKlines });

    const candles = await fetchKlines({
      symbol: "BTCUSDT",
      interval: "1m",
      startTimeMs: 0,
      endTimeMs: 59_999,
      limit: 1000
    });

    expect(getKlines).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      interval: "1m",
      startTime: 0,
      endTime: 59_999,
      limit: 1000
    });
    expect(candles).toHaveLength(1);
    expect(candles[0]?.symbol).toBe("BTCUSDT");
    expect(candles[0]?.open.toString()).toBe("100.1");
    expect(candles[0]?.close.toString()).toBe("100.5");
    expect(candles[0]?.closed).toBe(true);
  });
});
