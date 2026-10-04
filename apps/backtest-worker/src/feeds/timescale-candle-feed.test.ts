import { describe, expect, it, vi } from "vitest";
import { Decimal, type Candle } from "@meridian/core";
import { createTimescaleCandleFeed, mapKlineRow, type KlineRow } from "./timescale-candle-feed.js";

function createRow(): KlineRow {
  return {
    symbol: "BTCUSDT",
    interval: "15m",
    open_time: new Date("2024-01-01T00:00:00.000Z"),
    close_time: new Date("2024-01-01T00:14:59.999Z"),
    open: "85123.123456789012345678",
    high: "85124.123456789012345678",
    low: "85122.123456789012345678",
    close: "85123.987654321098765432",
    volume: "0.000000000123456789",
    closed: true
  };
}

describe("mapKlineRow", () => {
  it("preserves numeric precision beyond JavaScript's number precision", () => {
    const row = createRow();
    const candle = mapKlineRow(row);

    for (const field of ["open", "high", "low", "close", "volume"] as const) {
      expect(candle[field]).toBeInstanceOf(Decimal);
      expect(candle[field].toFixed()).toBe(row[field]);
    }
  });

  it("maps UTC timestamps to milliseconds without losing the closing millisecond", () => {
    const candle = mapKlineRow(createRow());

    expect(candle.openTimeMs).toBe(1704067200000);
    expect(candle.closeTimeMs).toBe(1704068099999);
    expect(candle.symbol).toBe("BTCUSDT");
    expect(candle.interval).toBe("15m");
    expect(candle.closed).toBe(true);
  });

  it("preserves an open candle's flag so the reader can enforce closed-only delivery", () => {
    expect(mapKlineRow({ ...createRow(), closed: false }).closed).toBe(false);
  });
});

const fromMs = Date.UTC(2024, 0, 1);
const intervalMs = 15 * 60 * 1000;
const request = {
  symbol: "BTCUSDT",
  interval: "15m" as const,
  fromMs,
  toMs: fromMs + 1002 * intervalMs
};

function rowAt(index: number): KlineRow {
  return {
    ...createRow(),
    open_time: new Date(fromMs + index * intervalMs),
    close_time: new Date(fromMs + (index + 1) * intervalMs - 1)
  };
}

async function collect(candles: AsyncIterable<Candle>): Promise<Candle[]> {
  const result: Candle[] = [];
  for await (const candle of candles) result.push(candle);
  return result;
}

describe("createTimescaleCandleFeed", () => {
  it("uses a parameterized, closed-only query with inclusive start and exclusive end", async () => {
    const query = vi.fn(async () => ({ rows: [rowAt(0)] }));
    const feed = createTimescaleCandleFeed({ query });
    expect(query).not.toHaveBeenCalled();
    const candles = await collect(feed.read(request));
    expect(candles[0]?.openTimeMs).toBe(fromMs);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0] as unknown as [string, readonly unknown[]];
    expect(values).toEqual(["BTCUSDT", "15m", new Date(fromMs), new Date(request.toMs)]);
    expect(sql).toMatch(/symbol = \$1 AND interval = \$2/);
    expect(sql).toMatch(/open_time >= \$3 AND open_time < \$4/);
    expect(sql).toMatch(/close_time < \$4 AND closed = true/);
    expect(sql).toMatch(/ORDER BY open_time ASC/);
    expect(sql).toMatch(/LIMIT 1000/);
  });

  it("advances beyond the last timestamp across pages without repeating a candle", async () => {
    const query = vi
      .fn<Parameters<typeof createTimescaleCandleFeed>[0]["query"]>()
      .mockResolvedValueOnce({ rows: Array.from({ length: 1000 }, (_, index) => rowAt(index)) })
      .mockResolvedValueOnce({ rows: [rowAt(1000)] });
    const candles = await collect(createTimescaleCandleFeed({ query }).read(request));
    expect(candles).toHaveLength(1001);
    expect(new Set(candles.map((candle) => candle.openTimeMs)).size).toBe(1001);
    expect(candles.map((candle) => candle.openTimeMs)).toEqual(
      Array.from({ length: 1001 }, (_, index) => fromMs + index * intervalMs)
    );
    expect(query.mock.calls[1]?.[1]).toEqual([
      "BTCUSDT",
      "15m",
      new Date(fromMs + 999 * intervalMs + 1),
      new Date(request.toMs)
    ]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("terminates after an empty page, including after an exactly full batch", async () => {
    const query = vi
      .fn<Parameters<typeof createTimescaleCandleFeed>[0]["query"]>()
      .mockResolvedValueOnce({ rows: Array.from({ length: 1000 }, (_, index) => rowAt(index)) })
      .mockResolvedValueOnce({ rows: [] });
    expect(await collect(createTimescaleCandleFeed({ query }).read(request))).toHaveLength(1000);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("returns no candles for an empty dataset", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    expect(await collect(createTimescaleCandleFeed({ query }).read(request))).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each([
    [fromMs, fromMs],
    [fromMs + 1, fromMs],
    [NaN, request.toMs],
    [fromMs, Infinity],
    [fromMs + 0.5, request.toMs],
    [fromMs, 8_640_000_000_000_001]
  ])("rejects invalid time range %s to %s before querying", async (fromMs, toMs) => {
    const query = vi.fn(async () => ({ rows: [] }));
    await expect(
      collect(createTimescaleCandleFeed({ query }).read({ ...request, fromMs, toMs }))
    ).rejects.toThrow("Invalid candle feed time range");
    expect(query).not.toHaveBeenCalled();
  });

  it("propagates database failures instead of reporting an empty dataset", async () => {
    const error = new Error("database connection lost");
    const query = vi.fn(async () => {
      throw error;
    });
    await expect(collect(createTimescaleCandleFeed({ query }).read(request))).rejects.toBe(error);
  });

  it("does not fetch additional batches when the consumer stops early", async () => {
    const query = vi.fn(async () => ({
      rows: Array.from({ length: 1000 }, (_, index) => rowAt(index))
    }));
    for await (const candle of createTimescaleCandleFeed({ query }).read(request)) {
      expect(candle.openTimeMs).toBe(fromMs);
      break;
    }
    expect(query).toHaveBeenCalledTimes(1);
  });
});
