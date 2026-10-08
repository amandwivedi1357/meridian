import { Decimal } from "@meridian/core";
import { describe, expect, it } from "vitest";
import {
  decodeMarketEvent,
  encodeMarketEvent,
  encodeMarketEventJson,
  marketEventJsonCodec,
  marketEventProtobufCodec,
  type MarketEventMessage
} from "./index.js";

describe("market event protobuf codec", () => {
  it("round-trips trade events without decimal precision loss", () => {
    const event: MarketEventMessage = {
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

    const encoded = encodeMarketEvent(event);
    const decoded = decodeMarketEvent(encoded);

    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(encoded).startsWith("{")).toBe(false);
    expect(decoded.kind).toBe("trade");
    expect(decoded.symbol).toBe("BTCUSDT");
    expect(decoded.eventId).toBe("12345");

    if (decoded.kind !== "trade") {
      throw new Error("expected trade event");
    }

    expect(decoded.trade.price.toString()).toBe("100.10000001");
    expect(decoded.trade.quantity.toString()).toBe("0.02000003");
    expect(decoded.trade.isBuyerMaker).toBe(true);
  });

  it("round-trips kline events with interval and close state", () => {
    const event: MarketEventMessage = {
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

    const decoded = decodeMarketEvent(encodeMarketEvent(event));

    expect(decoded.kind).toBe("kline");
    expect(decoded.symbol).toBe("ETHUSDT");
    expect(decoded.eventId).toBe("1m:1700000000000");

    if (decoded.kind !== "kline") {
      throw new Error("expected kline event");
    }

    expect(decoded.candle.interval).toBe("1m");
    expect(decoded.candle.close.toString()).toBe("2001.25");
    expect(decoded.candle.closed).toBe(true);
  });

  it("round-trips depth events with sequence ids and zero-quantity levels", () => {
    const event: MarketEventMessage = {
      kind: "depth",
      symbol: "BNBUSDT",
      eventId: "12",
      occurredAtMs: 1_700_000_000_500,
      depth: {
        firstUpdateId: 10,
        finalUpdateId: 12,
        bids: [
          { price: new Decimal("300.10"), quantity: new Decimal("1.50") },
          { price: new Decimal("300.00"), quantity: new Decimal("0") }
        ],
        asks: [{ price: new Decimal("301.20"), quantity: new Decimal("2.25") }]
      }
    };

    const decoded = decodeMarketEvent(encodeMarketEvent(event));

    expect(decoded.kind).toBe("depth");
    expect(decoded.symbol).toBe("BNBUSDT");
    expect(decoded.eventId).toBe("12");

    if (decoded.kind !== "depth") {
      throw new Error("expected depth event");
    }

    expect(decoded.depth.firstUpdateId).toBe(10);
    expect(decoded.depth.finalUpdateId).toBe(12);
    expect(decoded.depth.bids[0]?.price.toString()).toBe("300.1");
    expect(decoded.depth.bids[1]?.quantity.toString()).toBe("0");
    expect(decoded.depth.asks[0]?.quantity.toString()).toBe("2.25");
  });

  it("exposes the default protobuf codec behind the EventCodec interface", () => {
    const event: MarketEventMessage = {
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

    const decoded = marketEventProtobufCodec.decode(marketEventProtobufCodec.encode(event));

    expect(decoded).toEqual(decodeMarketEvent(encodeMarketEvent(event)));
  });

  it("keeps JSON bytes available as an explicit debug codec", () => {
    const event: MarketEventMessage = {
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

    expect(new TextDecoder().decode(encodeMarketEventJson(event)).startsWith("{")).toBe(true);
    const decoded = marketEventJsonCodec.decode(marketEventJsonCodec.encode(event));

    expect(decoded).toEqual(decodeMarketEvent(encodeMarketEvent(event)));
  });
});
