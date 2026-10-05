import { describe, expect, it, vi } from "vitest";
import { Decimal, type Candle } from "@meridian/core";
import { createRecordedSessionCandleFeed } from "./recorded-session-feed.js";

const fromMs = Date.UTC(2024, 0, 1);
const intervalMs = 15 * 60 * 1000;
const request = {
  symbol: "BTCUSDT",
  interval: "15m" as const,
  fromMs,
  toMs: fromMs + 3 * intervalMs
};

async function collect(candles: AsyncIterable<Candle>): Promise<Candle[]> {
  const result: Candle[] = [];
  for await (const candle of candles) result.push(candle);
  return result;
}

function klineRecord(index: number, override: Record<string, unknown> = {}) {
  const openTimeMs = fromMs + index * intervalMs;
  return {
    kind: "kline",
    symbol: "BTCUSDT",
    eventId: `15m:${openTimeMs}`,
    occurredAtMs: openTimeMs + intervalMs,
    candle: {
      symbol: "BTCUSDT",
      interval: "15m",
      openTimeMs,
      closeTimeMs: openTimeMs + intervalMs - 1,
      open: `${100 + index}.123456789012345678`,
      high: `${101 + index}.123456789012345678`,
      low: `${99 + index}.123456789012345678`,
      close: `${100 + index}.987654321098765432`,
      volume: "12.34567890123456789",
      closed: true,
      ...override
    }
  };
}

function line(record: unknown): string {
  return JSON.stringify(record);
}

describe("createRecordedSessionCandleFeed", () => {
  it("reads closed matching kline records from replayable NDJSON in time order", async () => {
    const readFile = vi.fn(async () =>
      [
        line(klineRecord(2)),
        line({
          kind: "trade",
          symbol: "BTCUSDT",
          eventId: "trade-1",
          occurredAtMs: fromMs,
          trade: {}
        }),
        line(klineRecord(0)),
        line(klineRecord(1, { closed: false })),
        line(klineRecord(1))
      ].join("\n")
    );

    const candles = await collect(
      createRecordedSessionCandleFeed("sessions/test.ndjson", { readFile }).read(request)
    );

    expect(readFile).toHaveBeenCalledWith("sessions/test.ndjson", "utf8");
    expect(candles.map((candle) => candle.openTimeMs)).toEqual([
      fromMs,
      fromMs + intervalMs,
      fromMs + 2 * intervalMs
    ]);
    expect(candles[0]?.open).toBeInstanceOf(Decimal);
    expect(candles[0]?.open.toFixed()).toBe("100.123456789012345678");
    expect(candles[0]?.close.toFixed()).toBe("100.987654321098765432");
    expect(candles[0]?.volume.toFixed()).toBe("12.34567890123456789");
  });

  it("filters symbol, interval, and exclusive end range", async () => {
    const readFile = vi.fn(async () =>
      [
        line(klineRecord(-1)),
        line({ ...klineRecord(0, { symbol: "ETHUSDT" }), symbol: "ETHUSDT" }),
        line(klineRecord(1, { interval: "1h" })),
        line(klineRecord(2)),
        line(klineRecord(3))
      ].join("\n")
    );

    const candles = await collect(
      createRecordedSessionCandleFeed("sessions/test.ndjson", { readFile }).read(request)
    );

    expect(candles.map((candle) => candle.openTimeMs)).toEqual([fromMs + 2 * intervalMs]);
  });

  it("rejects invalid ranges before reading the recording", async () => {
    const readFile = vi.fn(async () => "");

    await expect(
      collect(
        createRecordedSessionCandleFeed("sessions/test.ndjson", { readFile }).read({
          ...request,
          toMs: request.fromMs
        })
      )
    ).rejects.toThrow("Invalid recorded session feed time range");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON lines with their line number", async () => {
    const readFile = vi.fn(async () => `${line(klineRecord(0))}\n{ nope`);

    await expect(
      collect(createRecordedSessionCandleFeed("sessions/test.ndjson", { readFile }).read(request))
    ).rejects.toThrow("Invalid recorded session line 2");
  });

  it("rejects malformed kline records instead of silently skipping corrupt candles", async () => {
    const readFile = vi.fn(async () => line(klineRecord(0, { open: undefined })));

    await expect(
      collect(createRecordedSessionCandleFeed("sessions/test.ndjson", { readFile }).read(request))
    ).rejects.toThrow("Invalid recorded kline candle");
  });
});
