import { Decimal } from "@meridian/core";
import { decodeMarketEvent, encodeMarketEvent } from "@meridian/proto";
import { describe, expect, it, vi } from "vitest";
import {
  publishNormalizedMarketEvent,
  type MarketEventPublisherDeps
} from "../market-publisher.js";
import type { NormalizedMarketEvent } from "../market-events.js";

describe("publishNormalizedMarketEvent", () => {
  it("protobuf-encodes and publishes trade events to the symbol trade stream", async () => {
    const event: NormalizedMarketEvent = {
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
    const encoded = new Uint8Array([1, 2, 3]);
    const encode = vi.fn(() => encoded);
    const xadd = vi.fn(async () => "1700000000000-0");

    const result = await publishNormalizedMarketEvent(event, { encode, xadd });

    expect(encode).toHaveBeenCalledWith(event);
    expect(xadd).toHaveBeenCalledWith("market.trade.BTCUSDT", "*", {
      schemaVersion: "meridian.v1",
      kind: "trade",
      symbol: "BTCUSDT",
      eventId: "12345",
      occurredAtMs: "1700000000000",
      payload: Buffer.from(encoded)
    });
    expect(result).toEqual({
      stream: "market.trade.BTCUSDT",
      id: "1700000000000-0"
    });
  });

  it("routes kline events to the interval-specific kline stream", async () => {
    const event: NormalizedMarketEvent = {
      kind: "kline",
      symbol: "ETHUSDT",
      eventId: "1m:1700000000000",
      occurredAtMs: 1_700_000_060_000,
      candle: {
        symbol: "ETHUSDT",
        interval: "1m",
        openTimeMs: 1_700_000_000_000,
        closeTimeMs: 1_700_000_059_999,
        open: new Decimal("2000"),
        high: new Decimal("2002.5"),
        low: new Decimal("1999.75"),
        close: new Decimal("2001.25"),
        volume: new Decimal("12.345"),
        closed: true
      }
    };
    const xadd = vi.fn(async () => "1700000060000-0");

    const result = await publishNormalizedMarketEvent(event, {
      encode: () => new Uint8Array([4, 5, 6]),
      xadd
    });

    expect(xadd).toHaveBeenCalledWith(
      "market.kline.ETHUSDT.1m",
      "*",
      expect.objectContaining({
        kind: "kline",
        symbol: "ETHUSDT",
        eventId: "1m:1700000000000"
      })
    );
    expect(result.stream).toBe("market.kline.ETHUSDT.1m");
  });

  it("routes depth events to the symbol book stream", async () => {
    const event: NormalizedMarketEvent = {
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
    const xadd = vi.fn(async () => "1700000000500-0");

    const result = await publishNormalizedMarketEvent(event, {
      encode: () => new Uint8Array([7, 8, 9]),
      xadd
    });

    expect(xadd).toHaveBeenCalledWith(
      "market.book.BNBUSDT",
      "*",
      expect.objectContaining({
        kind: "depth",
        symbol: "BNBUSDT",
        eventId: "12"
      })
    );
    expect(result.stream).toBe("market.book.BNBUSDT");
  });

  it("publishes payloads that consumers can decode with the shared market codec", async () => {
    const event: NormalizedMarketEvent = {
      kind: "trade",
      symbol: "BTCUSDT",
      eventId: "12345",
      occurredAtMs: 1_700_000_000_000,
      trade: {
        symbol: "BTCUSDT",
        tradeId: "12345",
        price: new Decimal("100.10000001"),
        quantity: new Decimal("0.02000003"),
        eventTimeMs: 1_700_000_000_000,
        isBuyerMaker: true
      }
    };
    let publishedFields: Parameters<MarketEventPublisherDeps["xadd"]>[2] | undefined;
    const xadd = vi.fn(async (...args: Parameters<MarketEventPublisherDeps["xadd"]>) => {
      publishedFields = args[2];
      return "1700000000000-0";
    });

    await publishNormalizedMarketEvent(event, {
      encode: encodeMarketEvent,
      xadd
    });

    expect(publishedFields).toBeDefined();

    const decoded = decodeMarketEvent(publishedFields?.payload ?? Buffer.from([]));

    expect(decoded.kind).toBe("trade");
    expect(decoded.symbol).toBe("BTCUSDT");

    if (decoded.kind !== "trade") {
      throw new Error("expected trade event");
    }

    expect(decoded.trade.price.toString()).toBe("100.10000001");
    expect(decoded.trade.quantity.toString()).toBe("0.02000003");
  });
});
