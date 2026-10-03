import { describe, expect, it } from "vitest";
import { planKlineBackfillRequests } from "../kline-backfill-planner.js";

describe("planKlineBackfillRequests", () => {
  it("splits a range into limit-sized kline requests", () => {
    const requests = planKlineBackfillRequests({
      symbol: "BTCUSDT",
      interval: "1m",
      startTimeMs: 0,
      endTimeMs: 180_000,
      limit: 2
    });

    expect(requests).toEqual([
      {
        symbol: "BTCUSDT",
        interval: "1m",
        startTimeMs: 0,
        endTimeMs: 119_999,
        limit: 2
      },
      {
        symbol: "BTCUSDT",
        interval: "1m",
        startTimeMs: 120_000,
        endTimeMs: 180_000,
        limit: 2
      }
    ]);
  });

  it("supports common Binance kline intervals", () => {
    expect(
      planKlineBackfillRequests({
        symbol: "ETHUSDT",
        interval: "5m",
        startTimeMs: 0,
        endTimeMs: 900_000,
        limit: 2
      })
    ).toHaveLength(2);
  });

  it("rejects unsupported intervals and invalid ranges", () => {
    expect(() =>
      planKlineBackfillRequests({
        symbol: "BTCUSDT",
        interval: "2m",
        startTimeMs: 0,
        endTimeMs: 60_000,
        limit: 1000
      })
    ).toThrow();

    expect(() =>
      planKlineBackfillRequests({
        symbol: "BTCUSDT",
        interval: "1m",
        startTimeMs: 60_000,
        endTimeMs: 0,
        limit: 1000
      })
    ).toThrow();
  });
});
