import { Decimal, type Candle, type Trade, type BookLevel } from "@meridian/core";
import { z } from "zod";

export type NormalizedMarketEvent =
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

function decimal(value: string): Decimal {
  return new Decimal(value);
}

const decimalString = z.string().min(1);
const levelSchema = z.tuple([decimalString, decimalString]);

const tradeSchema = z.object({
  e: z.literal("trade"),
  E: z.number(),
  s: z.string(),
  t: z.number(),
  p: decimalString,
  q: decimalString,
  b: z.number().optional(),
  a: z.number().optional(),
  T: z.number(),
  m: z.boolean(),
  M: z.boolean()
});

const klineSchema = z.object({
  e: z.literal("kline"),
  E: z.number(),
  s: z.string(),
  k: z.object({
    t: z.number(),
    T: z.number(),
    s: z.string(),
    i: z.string(),
    f: z.number(),
    L: z.number(),
    o: decimalString,
    c: decimalString,
    h: decimalString,
    l: decimalString,
    v: decimalString,
    n: z.number(),
    x: z.boolean(),
    q: decimalString,
    V: decimalString,
    Q: decimalString,
    B: z.string()
  })
});

const depthSchema = z.object({
  e: z.literal("depthUpdate"),
  E: z.number(),
  s: z.string(),
  U: z.number(),
  u: z.number(),
  b: z.array(levelSchema),
  a: z.array(levelSchema)
});

const payloadSchema = z.discriminatedUnion("e", [tradeSchema, klineSchema, depthSchema]);

export function normalizeMarketStreamEvent(input: unknown): NormalizedMarketEvent {
  const payload = payloadSchema.parse(input);

  switch (payload.e) {
    case "trade":
      return {
        kind: "trade",
        symbol: payload.s,
        eventId: String(payload.t),
        occurredAtMs: payload.E,
        trade: {
          symbol: payload.s,
          tradeId: String(payload.t),
          price: decimal(payload.p),
          quantity: decimal(payload.q),
          eventTimeMs: payload.E,
          isBuyerMaker: payload.m
        }
      };
    case "kline": {
      if (payload.k.s !== payload.s) {
        throw new Error(`Kline symbol mismatch: outer=${payload.s} inner=${payload.k.s}`);
      }
      return {
        kind: "kline",
        symbol: payload.s,
        eventId: `${payload.k.i}:${payload.k.t}`,
        occurredAtMs: payload.E,
        candle: {
          symbol: payload.s,
          interval: payload.k.i,
          openTimeMs: payload.k.t,
          closeTimeMs: payload.k.T,
          open: decimal(payload.k.o),
          high: decimal(payload.k.h),
          low: decimal(payload.k.l),
          close: decimal(payload.k.c),
          volume: decimal(payload.k.v),
          closed: payload.k.x
        }
      };
    }
    case "depthUpdate":
      return {
        kind: "depth",
        symbol: payload.s,
        eventId: String(payload.u),
        occurredAtMs: payload.E,
        depth: {
          firstUpdateId: payload.U,
          finalUpdateId: payload.u,
          bids: payload.b.map(([price, quantity]) => ({
            price: decimal(price),
            quantity: decimal(quantity)
          })),
          asks: payload.a.map(([price, quantity]) => ({
            price: decimal(price),
            quantity: decimal(quantity)
          }))
        }
      };
  }
}
