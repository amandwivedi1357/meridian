import { Decimal, type BookSnapshot, type Candle } from "@meridian/core";
import type { BinanceDepthResponse, BinanceKlineResponse } from "./types.js";

export function parseDepthResponse(
  symbol: string,
  response: BinanceDepthResponse,
  eventTimeMs: number
): BookSnapshot {
  return {
    symbol,
    eventTimeMs,
    bids: response.bids.map(([price, quantity]) => ({
      price: new Decimal(price),
      quantity: new Decimal(quantity)
    })),
    asks: response.asks.map(([price, quantity]) => ({
      price: new Decimal(price),
      quantity: new Decimal(quantity)
    }))
  };
}
export function parseKlineResponse(
  symbol: string,
  interval: string,
  response: BinanceKlineResponse
): Candle {
  const [openTime, open, high, low, close, volume, closeTime] = response;

  return {
    symbol,
    interval,
    openTimeMs: openTime,
    closeTimeMs: closeTime,
    open: new Decimal(open),
    high: new Decimal(high),
    low: new Decimal(low),
    close: new Decimal(close),
    volume: new Decimal(volume),
    closed: true
  };
}
