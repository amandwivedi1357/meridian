import { Decimal, type Candle, type Trade } from "@meridian/core";
import type { BinanceKlineStreamPayload, BinanceTradeStreamPayload } from "./payloads.js";

export function parseTradeStreamPayload(payload: BinanceTradeStreamPayload): Trade {
  return {
    symbol: payload.s,
    tradeId: String(payload.t),
    price: new Decimal(payload.p),
    quantity: new Decimal(payload.q),
    eventTimeMs: payload.E,
    isBuyerMaker: payload.m
  };
}

export function parseKlineStreamPayload(payload: BinanceKlineStreamPayload): Candle {
  const kline = payload.k;

  return {
    symbol: payload.s,
    interval: kline.i,
    openTimeMs: kline.t,
    closeTimeMs: kline.T,
    open: new Decimal(kline.o),
    high: new Decimal(kline.h),
    low: new Decimal(kline.l),
    close: new Decimal(kline.c),
    volume: new Decimal(kline.v),
    closed: kline.x
  };
}
