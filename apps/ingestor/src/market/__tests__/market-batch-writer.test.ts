import { Decimal } from "@meridian/core";
import { describe, expect, it, vi } from "vitest";
import { writeMarketEventBatch } from "../market-batch-writer.js";
import type { NormalizedMarketEvent } from "../market-events.js";

describe("writeMarketEventBatch", () => {
  const mixed: NormalizedMarketEvent[] = [
    {
      kind: "trade",
      symbol: "BTCUSDT",
      eventId: "1",
      occurredAtMs: 1,
      trade: {
        symbol: "BTCUSDT",
        tradeId: "1",
        eventTimeMs: 1,
        price: new Decimal(100),
        quantity: new Decimal(1),
        isBuyerMaker: false
      }
    },
    {
      kind: "kline",
      symbol: "BTCUSDT",
      eventId: "1m:0",
      occurredAtMs: 1,
      candle: {
        symbol: "BTCUSDT",
        interval: "1m",
        openTimeMs: 0,
        closeTimeMs: 59999,
        open: new Decimal(100),
        high: new Decimal(100),
        low: new Decimal(100),
        close: new Decimal(100),
        volume: new Decimal(1),
        closed: true
      }
    }
  ];
  it("starts independent mixed writes together and waits for both", async () => {
    let releaseTrade!: () => void;
    let releaseKline!: () => void;
    const upsertTrades = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseTrade = resolve;
        })
    );
    const upsertKlines = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseKline = resolve;
        })
    );
    const work = writeMarketEventBatch(mixed, { upsertTrades, upsertKlines, parallelWrites: true });
    const finished = vi.fn();
    void work.then(finished);
    expect(upsertTrades).toHaveBeenCalledOnce();
    expect(upsertKlines).toHaveBeenCalledOnce();
    releaseTrade();
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    releaseKline();
    await expect(work).resolves.toEqual({
      tradesWritten: 1,
      klinesWritten: 1,
      duplicatesSkipped: 0
    });
  });
  it("drains the other write before reporting failure", async () => {
    let release!: () => void;
    const work = writeMarketEventBatch(mixed, {
      parallelWrites: true,
      upsertTrades: async () => {
        throw new Error("write failed");
      },
      upsertKlines: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    });
    const rejected = vi.fn();
    void work.catch(rejected);
    await Promise.resolve();
    await Promise.resolve();
    expect(rejected).not.toHaveBeenCalled();
    release();
    await expect(work).rejects.toThrow("write failed");
  });
  it("deduplicates trade events by symbol and eventId before upserting", async () => {
    const trade: NormalizedMarketEvent = {
      kind: "trade",
      symbol: "BTCUSDT",
      eventId: "12345",
      occurredAtMs: 1_700_000_000_000,
      trade: {
        symbol: "BTCUSDT",
        tradeId: "12345",
        price: new Decimal("100.10"),
        quantity: new Decimal("0.02"),
        eventTimeMs: 1_700_000_000_000,
        isBuyerMaker: true
      }
    };
    const upsertTrades = vi.fn(async () => undefined);
    const upsertKlines = vi.fn(async () => undefined);

    const result = await writeMarketEventBatch([trade, trade], {
      upsertTrades,
      upsertKlines
    });

    expect(upsertTrades).toHaveBeenCalledOnce();
    expect(upsertTrades).toHaveBeenCalledWith([
      {
        symbol: "BTCUSDT",
        eventId: "12345",
        tradeId: "12345",
        eventTimeMs: 1_700_000_000_000,
        price: new Decimal("100.10"),
        quantity: new Decimal("0.02"),
        isBuyerMaker: true
      }
    ]);
    expect(upsertKlines).not.toHaveBeenCalled();
    expect(result).toEqual({
      tradesWritten: 1,
      klinesWritten: 0,
      duplicatesSkipped: 1
    });
  });

  it("deduplicates kline events by symbol and eventId before upserting", async () => {
    const kline: NormalizedMarketEvent = {
      kind: "kline",
      symbol: "ETHUSDT",
      eventId: "1m:1700000000000",
      occurredAtMs: 1_700_000_060_000,
      candle: {
        symbol: "ETHUSDT",
        interval: "1m",
        openTimeMs: 1_700_000_000_000,
        closeTimeMs: 1_700_000_059_999,
        open: new Decimal("2000.00"),
        high: new Decimal("2002.50"),
        low: new Decimal("1999.75"),
        close: new Decimal("2001.25"),
        volume: new Decimal("12.345"),
        closed: true
      }
    };
    const upsertTrades = vi.fn(async () => undefined);
    const upsertKlines = vi.fn(async () => undefined);

    const result = await writeMarketEventBatch([kline, kline], {
      upsertTrades,
      upsertKlines
    });

    expect(upsertTrades).not.toHaveBeenCalled();
    expect(upsertKlines).toHaveBeenCalledOnce();
    expect(upsertKlines).toHaveBeenCalledWith([
      {
        symbol: "ETHUSDT",
        eventId: "1m:1700000000000",
        interval: "1m",
        openTimeMs: 1_700_000_000_000,
        closeTimeMs: 1_700_000_059_999,
        open: new Decimal("2000.00"),
        high: new Decimal("2002.50"),
        low: new Decimal("1999.75"),
        close: new Decimal("2001.25"),
        volume: new Decimal("12.345"),
        closed: true
      }
    ]);
    expect(result).toEqual({
      tradesWritten: 0,
      klinesWritten: 1,
      duplicatesSkipped: 1
    });
  });

  it("does not persist depth events in the trades/klines batch writer", async () => {
    const depth: NormalizedMarketEvent = {
      kind: "depth",
      symbol: "BNBUSDT",
      eventId: "12",
      occurredAtMs: 1_700_000_000_500,
      depth: {
        firstUpdateId: 10,
        finalUpdateId: 12,
        bids: [{ price: new Decimal("300.10"), quantity: new Decimal("1.5") }],
        asks: [{ price: new Decimal("301.20"), quantity: new Decimal("2.25") }]
      }
    };
    const upsertTrades = vi.fn(async () => undefined);
    const upsertKlines = vi.fn(async () => undefined);

    const result = await writeMarketEventBatch([depth], {
      upsertTrades,
      upsertKlines
    });

    expect(upsertTrades).not.toHaveBeenCalled();
    expect(upsertKlines).not.toHaveBeenCalled();
    expect(result).toEqual({
      tradesWritten: 0,
      klinesWritten: 0,
      duplicatesSkipped: 0
    });
  });
});
