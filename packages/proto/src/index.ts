import { Decimal, type BookLevel, type Candle, type Trade } from "@meridian/core";

export const schemaVersion = "meridian.v1";

export type MarketEventMessage =
  | {
      readonly kind: "trade";
      readonly symbol: string;
      readonly eventId: string;
      readonly occurredAtMs: number;
      readonly trade: Trade;
    }
  | {
      readonly kind: "kline";
      readonly symbol: string;
      readonly eventId: string;
      readonly occurredAtMs: number;
      readonly candle: Candle;
    }
  | {
      readonly kind: "depth";
      readonly symbol: string;
      readonly eventId: string;
      readonly occurredAtMs: number;
      readonly depth: {
        readonly firstUpdateId: number;
        readonly finalUpdateId: number;
        readonly bids: readonly BookLevel[];
        readonly asks: readonly BookLevel[];
      };
    };

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeMarketEvent(event: MarketEventMessage): Uint8Array {
  return textEncoder.encode(JSON.stringify(toWireMarketEvent(event)));
}

export function decodeMarketEvent(bytes: Uint8Array): MarketEventMessage {
  const wire = JSON.parse(textDecoder.decode(bytes)) as WireMarketEvent;

  switch (wire.kind) {
    case "trade":
      return {
        kind: "trade",
        symbol: wire.symbol,
        eventId: wire.eventId,
        occurredAtMs: wire.occurredAtMs,
        trade: {
          symbol: wire.trade.symbol,
          tradeId: wire.trade.tradeId,
          price: new Decimal(wire.trade.price),
          quantity: new Decimal(wire.trade.quantity),
          eventTimeMs: wire.trade.eventTimeMs,
          isBuyerMaker: wire.trade.isBuyerMaker
        }
      };

    case "kline":
      return {
        kind: "kline",
        symbol: wire.symbol,
        eventId: wire.eventId,
        occurredAtMs: wire.occurredAtMs,
        candle: {
          symbol: wire.candle.symbol,
          interval: wire.candle.interval,
          openTimeMs: wire.candle.openTimeMs,
          closeTimeMs: wire.candle.closeTimeMs,
          open: new Decimal(wire.candle.open),
          high: new Decimal(wire.candle.high),
          low: new Decimal(wire.candle.low),
          close: new Decimal(wire.candle.close),
          volume: new Decimal(wire.candle.volume),
          closed: wire.candle.closed
        }
      };

    case "depth":
      return {
        kind: "depth",
        symbol: wire.symbol,
        eventId: wire.eventId,
        occurredAtMs: wire.occurredAtMs,
        depth: {
          firstUpdateId: wire.depth.firstUpdateId,
          finalUpdateId: wire.depth.finalUpdateId,
          bids: wire.depth.bids.map(fromWireLevel),
          asks: wire.depth.asks.map(fromWireLevel)
        }
      };
  }
}

function toWireMarketEvent(event: MarketEventMessage): WireMarketEvent {
  switch (event.kind) {
    case "trade":
      return {
        ...event,
        trade: {
          ...event.trade,
          price: event.trade.price.toString(),
          quantity: event.trade.quantity.toString()
        }
      };

    case "kline":
      return {
        ...event,
        candle: {
          ...event.candle,
          open: event.candle.open.toString(),
          high: event.candle.high.toString(),
          low: event.candle.low.toString(),
          close: event.candle.close.toString(),
          volume: event.candle.volume.toString()
        }
      };

    case "depth":
      return {
        ...event,
        depth: {
          ...event.depth,
          bids: event.depth.bids.map(toWireLevel),
          asks: event.depth.asks.map(toWireLevel)
        }
      };
  }
}

function toWireLevel(level: BookLevel): WireBookLevel {
  return {
    price: level.price.toString(),
    quantity: level.quantity.toString()
  };
}

function fromWireLevel(level: WireBookLevel): BookLevel {
  return {
    price: new Decimal(level.price),
    quantity: new Decimal(level.quantity)
  };
}

type WireBookLevel = {
  readonly price: string;
  readonly quantity: string;
};

type WireMarketEvent =
  | {
      readonly kind: "trade";
      readonly symbol: string;
      readonly eventId: string;
      readonly occurredAtMs: number;
      readonly trade: {
        readonly symbol: string;
        readonly tradeId: string;
        readonly price: string;
        readonly quantity: string;
        readonly eventTimeMs: number;
        readonly isBuyerMaker: boolean;
      };
    }
  | {
      readonly kind: "kline";
      readonly symbol: string;
      readonly eventId: string;
      readonly occurredAtMs: number;
      readonly candle: {
        readonly symbol: string;
        readonly interval: string;
        readonly openTimeMs: number;
        readonly closeTimeMs: number;
        readonly open: string;
        readonly high: string;
        readonly low: string;
        readonly close: string;
        readonly volume: string;
        readonly closed: boolean;
      };
    }
  | {
      readonly kind: "depth";
      readonly symbol: string;
      readonly eventId: string;
      readonly occurredAtMs: number;
      readonly depth: {
        readonly firstUpdateId: number;
        readonly finalUpdateId: number;
        readonly bids: readonly WireBookLevel[];
        readonly asks: readonly WireBookLevel[];
      };
    };
