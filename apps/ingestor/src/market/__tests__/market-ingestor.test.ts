import { Decimal } from "@meridian/core";
import { describe, expect, it, vi } from "vitest";
import { ingestMarketStreamEvent } from "../market-ingestor.js";
import type { NormalizedMarketEvent } from "../market-events.js";

describe("ingestMarketStreamEvent", () => {
  it("normalizes a raw trade event, publishes it, and includes it in the DB batch", async () => {
    let publishedEvent: NormalizedMarketEvent | undefined;
    const publish = vi.fn(async (event: NormalizedMarketEvent) => {
      publishedEvent = event;
      return {
        stream: "market.trade.BTCUSDT",
        id: "1700000000000-0"
      };
    });
    const writeBatch = vi.fn(async () => ({
      tradesWritten: 1,
      klinesWritten: 0,
      duplicatesSkipped: 0
    }));
    const sessionRecorder = {
      record: vi.fn(async () => undefined)
    };

    const result = await ingestMarketStreamEvent(
      {
        e: "trade",
        E: 1_700_000_000_000,
        s: "BTCUSDT",
        t: 12345,
        p: "100.10",
        q: "0.0200",
        b: 1,
        a: 2,
        T: 1_700_000_000_001,
        m: true,
        M: true
      },
      { publish, writeBatch, sessionRecorder }
    );

    expect(sessionRecorder.record).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledOnce();
    expect(writeBatch).toHaveBeenCalledOnce();

    expect(publishedEvent).toEqual({
      kind: "trade",
      symbol: "BTCUSDT",
      eventId: "12345",
      occurredAtMs: 1_700_000_000_000,
      trade: {
        symbol: "BTCUSDT",
        tradeId: "12345",
        price: new Decimal("100.10"),
        quantity: new Decimal("0.0200"),
        eventTimeMs: 1_700_000_000_000,
        isBuyerMaker: true
      }
    });
    expect(sessionRecorder.record).toHaveBeenCalledWith(publishedEvent);
    expect(writeBatch).toHaveBeenCalledWith([publishedEvent]);
    expect(result).toEqual({
      event: publishedEvent,
      publishResult: {
        stream: "market.trade.BTCUSDT",
        id: "1700000000000-0"
      },
      batchWriteResult: {
        tradesWritten: 1,
        klinesWritten: 0,
        duplicatesSkipped: 0
      }
    });
  });

  it("records normalized events before publishing and writing", async () => {
    const calls: string[] = [];
    const publish = vi.fn(async () => {
      calls.push("publish");
      return {
        stream: "market.trade.BTCUSDT",
        id: "1700000000000-0"
      };
    });
    const writeBatch = vi.fn(async () => {
      calls.push("writeBatch");
      return {
        tradesWritten: 1,
        klinesWritten: 0,
        duplicatesSkipped: 0
      };
    });
    const sessionRecorder = {
      record: vi.fn(async () => {
        calls.push("record");
      })
    };

    await ingestMarketStreamEvent(
      {
        e: "trade",
        E: 1_700_000_000_000,
        s: "BTCUSDT",
        t: 12345,
        p: "100.10",
        q: "0.0200",
        b: 1,
        a: 2,
        T: 1_700_000_000_001,
        m: true,
        M: true
      },
      { publish, writeBatch, sessionRecorder }
    );

    expect(calls).toEqual(["record", "publish", "writeBatch"]);
  });

  it("does not publish or write malformed events", async () => {
    const publish = vi.fn(async () => ({
      stream: "market.trade.BTCUSDT",
      id: "1700000000000-0"
    }));
    const writeBatch = vi.fn(async () => ({
      tradesWritten: 1,
      klinesWritten: 0,
      duplicatesSkipped: 0
    }));
    const sessionRecorder = {
      record: vi.fn(async () => undefined)
    };

    await expect(
      ingestMarketStreamEvent(
        {
          e: "trade",
          E: 1_700_000_000_000,
          s: "BTCUSDT",
          t: 12345,
          p: "bad-price",
          q: "0.0200",
          b: 1,
          a: 2,
          T: 1_700_000_000_001,
          m: true,
          M: true
        },
        { publish, writeBatch, sessionRecorder }
      )
    ).rejects.toThrow();

    expect(sessionRecorder.record).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(writeBatch).not.toHaveBeenCalled();
  });
});
