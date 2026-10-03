import type { StreamSubscription } from "./stream-types.js";

export type KlineInterval = "1m" | "5m" | "15m" | "1h";

export function tradeStream(symbol: string): StreamSubscription {
  return {
    streamName: `${normalizeSymbol(symbol)}@trade`
  };
}

export function klineStream(symbol: string, interval: KlineInterval): StreamSubscription {
  return {
    streamName: `${normalizeSymbol(symbol)}@kline_${interval}`
  };
}

export function depthStream(symbol: string): StreamSubscription {
  return {
    streamName: `${normalizeSymbol(symbol)}@depth`
  };
}

function normalizeSymbol(symbol: string): string {
  return symbol.toLowerCase();
}