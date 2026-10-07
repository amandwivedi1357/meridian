import { Decimal, type Candle } from "@meridian/core";
import { describe, expect, it, vi } from "vitest";

import { createCandleFeedMarketDataSource } from "./market-data-source-adapter.js";
import type { CandleFeed } from "./candle-feed.js";

function candle(openTimeMs: number): Candle {
  return {
    symbol: "BTCUSDT",
    interval: "15m",
    openTimeMs,
    closeTimeMs: openTimeMs + 899_999,
    open: new Decimal("100"),
    high: new Decimal("110"),
    low: new Decimal("90"),
    close: new Decimal("105"),
    volume: new Decimal("1"),
    closed: true
  };
}

describe("createCandleFeedMarketDataSource", () => {
  it("adapts the backtest candle feed to the shared market data source contract", async () => {
    const feed: CandleFeed = {
      async *read() {
        yield candle(1_000);
        yield candle(2_000);
      }
    };
    const read = vi.spyOn(feed, "read");
    const source = createCandleFeedMarketDataSource(feed);

    const candles = [];
    for await (const item of source.getCandles({
      symbol: "BTCUSDT",
      interval: "15m",
      fromMs: 1_000,
      toMs: 3_000
    })) {
      candles.push(item);
    }

    expect(read).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      interval: "15m",
      fromMs: 1_000,
      toMs: 3_000
    });
    expect(candles.map((item) => item.openTimeMs)).toEqual([1_000, 2_000]);
  });

  it("requires explicit date bounds because backtest feeds are bounded readers", async () => {
    const source = createCandleFeedMarketDataSource({
      async *read() {
        yield candle(1_000);
      }
    });

    await expect(async () => {
      await source
        .getCandles({ symbol: "BTCUSDT", interval: "15m" })
        [Symbol.asyncIterator]()
        .next();
    }).rejects.toThrow("Candle feed market data requests require fromMs and toMs");
  });

  it("rejects intervals unsupported by the current backtest candle feed", async () => {
    const source = createCandleFeedMarketDataSource({
      async *read() {
        yield candle(1_000);
      }
    });

    await expect(async () => {
      await source
        .getCandles({
          symbol: "BTCUSDT",
          interval: "1m",
          fromMs: 1_000,
          toMs: 3_000
        })
        [Symbol.asyncIterator]()
        .next();
    }).rejects.toThrow("Unsupported candle feed interval");
  });
});
