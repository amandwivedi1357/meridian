import type { BinanceKlinesResponse } from "@meridian/binance-client";
import { describe, expect, it, vi } from "vitest";
import { createKlineBackfillService } from "../kline-backfill-service.js";

describe("createKlineBackfillService", () => {
  it("wires Binance kline fetching to Postgres kline persistence", async () => {
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
    const binance = {
      getKlines: vi.fn(async () => response)
    };
    const postgres = {
      query: vi.fn(async () => ({ rows: [] }))
    };
    const service = createKlineBackfillService({ binance, postgres });

    const result = await service.run({
      symbol: "BTCUSDT",
      interval: "1m",
      startTimeMs: 0,
      endTimeMs: 0,
      limit: 1000
    });

    expect(result).toEqual({
      requestsPlanned: 1,
      requestsCompleted: 1,
      candlesWritten: 1
    });
    expect(binance.getKlines).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      interval: "1m",
      startTime: 0,
      endTime: 0,
      limit: 1000
    });
    expect(postgres.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO klines"),
      expect.arrayContaining(["BTCUSDT", "1m:0", "1m"])
    );
  });
});
