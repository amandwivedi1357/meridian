import { describe, expect, it, vi } from "vitest";

import { createBinanceMarketDataSource } from "./market-data-source-adapter.js";
import type { BinanceKlinesResponse } from "./types.js";

describe("createBinanceMarketDataSource", () => {
  it("streams paged Binance klines as core candles", async () => {
    const firstPage: BinanceKlinesResponse = [
      [
        1_000,
        "100.00",
        "110.00",
        "90.00",
        "105.00",
        "2.50",
        1_999,
        "0",
        10,
        "0",
        "0",
        "0"
      ],
      [
        2_000,
        "105.00",
        "115.00",
        "95.00",
        "110.00",
        "3.50",
        2_999,
        "0",
        11,
        "0",
        "0",
        "0"
      ]
    ];
    const secondPage: BinanceKlinesResponse = [];
    const client = {
      getKlines: vi.fn(async () => (client.getKlines.mock.calls.length === 1 ? firstPage : secondPage))
    };
    const source = createBinanceMarketDataSource({ client, pageLimit: 2 });

    const candles = [];
    for await (const candle of source.getCandles({
      symbol: "BTCUSDT",
      interval: "15m",
      fromMs: 1_000,
      toMs: 4_000
    })) {
      candles.push(candle);
    }

    expect(client.getKlines).toHaveBeenNthCalledWith(1, {
      symbol: "BTCUSDT",
      interval: "15m",
      startTime: 1_000,
      endTime: 4_000,
      limit: 2
    });
    expect(client.getKlines).toHaveBeenNthCalledWith(2, {
      symbol: "BTCUSDT",
      interval: "15m",
      startTime: 3_000,
      endTime: 4_000,
      limit: 2
    });
    expect(candles).toHaveLength(2);
    expect(candles[0]?.close.toString()).toBe("105");
    expect(candles[1]?.volume.toString()).toBe("3.5");
  });

  it("honors an explicit request limit without fetching extra pages", async () => {
    const client = {
      getKlines: vi.fn(async (): Promise<BinanceKlinesResponse> => [
        [
          1_000,
          "100.00",
          "110.00",
          "90.00",
          "105.00",
          "2.50",
          1_999,
          "0",
          10,
          "0",
          "0",
          "0"
        ],
        [
          2_000,
          "105.00",
          "115.00",
          "95.00",
          "110.00",
          "3.50",
          2_999,
          "0",
          11,
          "0",
          "0",
          "0"
        ]
      ])
    };
    const source = createBinanceMarketDataSource({ client, pageLimit: 500 });

    const candles = [];
    for await (const candle of source.getCandles({
      symbol: "BTCUSDT",
      interval: "1m",
      limit: 1
    })) {
      candles.push(candle);
    }

    expect(client.getKlines).toHaveBeenCalledTimes(1);
    expect(client.getKlines).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      interval: "1m",
      startTime: undefined,
      endTime: undefined,
      limit: 1
    });
    expect(candles).toHaveLength(1);
  });
});
