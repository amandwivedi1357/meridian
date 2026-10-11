import type { MarketEvent, MarketSnapshot, TradingState } from "./api-client.js";

export function snapshot(now = Date.now()): MarketSnapshot {
  return {
    symbol: "BTCUSDT",
    interval: "15m",
    cursor: "bootstrap",
    checkedAt: now,
    book: {
      bids: [
        { price: "100", quantity: "2" },
        { price: "99", quantity: "1" }
      ],
      asks: [{ price: "101", quantity: "3" }],
      lastUpdateId: 10,
      eventTimeMs: now,
      complete: false
    },
    trades: [],
    candles: []
  };
}
export function account(now = Date.now()): TradingState {
  return {
    checkedAt: now,
    orders: [],
    fills: [],
    riskEvents: [],
    strategies: [],
    riskControl: null,
    portfolio: {
      checkedAt: now,
      equity: null,
      equityReason: "unavailable",
      positions: [],
      totals: []
    }
  };
}
export function depth(first = 11, final = 11): MarketEvent {
  return {
    kind: "depth",
    symbol: "BTCUSDT",
    eventId: "depth",
    occurredAtMs: Date.now(),
    depth: {
      firstUpdateId: first,
      finalUpdateId: final,
      bids: [{ price: "1e2", quantity: "0" }],
      asks: []
    }
  };
}
