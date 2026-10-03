import { Decimal } from "@meridian/core";
import { describe, expect, it, vi } from "vitest";
import { runKlineBackfill } from "../kline-backfill-runner.js";

describe("runKlineBackfill", () => {
  it("fetches planned kline windows and persists returned candles", async () => {
    const fetchKlines = vi.fn(async () => [
      {
        symbol: "BTCUSDT",
        interval: "1m",
        openTimeMs: 0,
        closeTimeMs: 59_999,
        open: new Decimal("100"),
        high: new Decimal("101"),
        low: new Decimal("99"),
        close: new Decimal("100.5"),
        volume: new Decimal("2"),
        closed: true
      }
    ]);
    const upsertKlines = vi.fn(async () => undefined);

    const result = await runKlineBackfill(
      {
        symbol: "BTCUSDT",
        interval: "1m",
        startTimeMs: 0,
        endTimeMs: 120_000,
        limit: 2
      },
      { fetchKlines, upsertKlines }
    );

    expect(fetchKlines).toHaveBeenCalledTimes(2);
    expect(fetchKlines).toHaveBeenNthCalledWith(1, {
      symbol: "BTCUSDT",
      interval: "1m",
      startTimeMs: 0,
      endTimeMs: 119_999,
      limit: 2
    });
    expect(upsertKlines).toHaveBeenCalledTimes(2);
    expect(upsertKlines).toHaveBeenCalledWith([
      {
        symbol: "BTCUSDT",
        eventId: "1m:0",
        interval: "1m",
        openTimeMs: 0,
        closeTimeMs: 59_999,
        open: new Decimal("100"),
        high: new Decimal("101"),
        low: new Decimal("99"),
        close: new Decimal("100.5"),
        volume: new Decimal("2"),
        closed: true
      }
    ]);
    expect(result).toEqual({
      requestsPlanned: 2,
      requestsCompleted: 2,
      candlesWritten: 2
    });
  });

  it("does not call upsert when a request returns no candles", async () => {
    const fetchKlines = vi.fn(async () => []);
    const upsertKlines = vi.fn(async () => undefined);

    const result = await runKlineBackfill(
      {
        symbol: "BTCUSDT",
        interval: "1m",
        startTimeMs: 0,
        endTimeMs: 0,
        limit: 1000
      },
      { fetchKlines, upsertKlines }
    );

    expect(upsertKlines).not.toHaveBeenCalled();
    expect(result).toEqual({
      requestsPlanned: 1,
      requestsCompleted: 1,
      candlesWritten: 0
    });
  });
});
