import { describe, expect, it } from "vitest";
import type { MarketEvent } from "./api-client.js";
import { account, depth, snapshot } from "./terminal-fixtures.js";
import { marketFromSnapshot, parseAccount, reduceMarket } from "./terminal-store.js";

describe("terminal market reducer", () => {
  it("canonicalizes decimals and deletes levels without mutating bootstrap", () => {
    const initial = marketFromSnapshot(snapshot(), "15m");
    const next = reduceMarket(initial, [depth()], "15m");
    expect(next.book?.bids).toEqual([{ price: "99", quantity: "1" }]);
    expect(initial.book?.bids).toHaveLength(2);
  });
  it("accepts REST-only snapshots that do not have a replay cursor yet", () => {
    const data = snapshot();
    data.cursor = "";
    expect(marketFromSnapshot(data, "15m").book?.lastUpdateId).toBe(10);
  });
  it("accepts overlapping depth ranges and skips duplicates", () => {
    const initial = marketFromSnapshot(snapshot(), "15m");
    const next = reduceMarket(initial, [depth(9, 11), depth(9, 11)], "15m");
    expect(next.book?.lastUpdateId).toBe(11);
  });
  it("rejects sequence gaps atomically", () => {
    const initial = marketFromSnapshot(snapshot(), "15m");
    expect(() => reduceMarket(initial, [depth(), depth(13, 13)], "15m")).toThrow("book_gap");
    expect(initial.book?.lastUpdateId).toBe(10);
  });
  it("requires bootstrap and resyncs when limited depth is exhausted", () => {
    expect(() =>
      reduceMarket({ candles: [], trades: [], book: null, updatedAt: null }, [depth()], "15m")
    ).toThrow();
    const update = depth();
    if (update.kind !== "depth") throw new Error();
    update.depth.bids.push({ price: "99", quantity: "0" });
    expect(() => reduceMarket(marketFromSnapshot(snapshot(), "15m"), [update], "15m")).toThrow(
      "book_resync_required"
    );
  });
  it.each([-16000, 6000])("rejects stale or future batches (%s)", (offset) => {
    const event = { ...depth(), occurredAtMs: Date.now() + offset };
    expect(() => reduceMarket(marketFromSnapshot(snapshot(), "15m"), [event], "15m")).toThrow(
      "stale_market_batch"
    );
  });
  it("rejects wrong topics, crossed books and unsafe decimal exponents", () => {
    const data = snapshot();
    data.interval = "1h";
    expect(() => marketFromSnapshot(data, "15m")).toThrow();
    data.interval = "15m";
    data.book.asks[0]!.price = "98";
    expect(() => marketFromSnapshot(data, "15m")).toThrow();
    data.book.asks[0]!.price = "1e1000000";
    expect(() => marketFromSnapshot(data, "15m")).toThrow("invalid_amount");
  });
  it("deduplicates and bounds trade history", () => {
    const events: MarketEvent[] = Array.from({ length: 250 }, (_, i) => ({
      kind: "trade",
      eventId: String(i),
      symbol: "BTCUSDT",
      occurredAtMs: Date.now(),
      trade: {
        tradeId: String(i),
        symbol: "BTCUSDT",
        price: "100",
        quantity: "1",
        eventTimeMs: Date.now(),
        isBuyerMaker: false
      }
    }));
    const next = reduceMarket(
      marketFromSnapshot(snapshot(), "15m"),
      [...events, events[249]!],
      "15m"
    );
    expect(next.trades).toHaveLength(200);
    expect(next.trades.at(-1)?.id).toBe("249");
  });
  it("upserts candles and rejects invalid OHLC", () => {
    const event: MarketEvent = {
      kind: "kline",
      symbol: "BTCUSDT",
      eventId: "c",
      occurredAtMs: Date.now(),
      candle: {
        symbol: "BTCUSDT",
        interval: "15m",
        openTimeMs: 0,
        closeTimeMs: 899999,
        open: "100",
        high: "102",
        low: "99",
        close: "101",
        volume: "1",
        closed: false
      }
    };
    const next = reduceMarket(marketFromSnapshot(snapshot(), "15m"), [event, event], "15m");
    expect(next.candles).toHaveLength(1);
    const invalid = { ...event, candle: { ...event.candle, close: "103" } };
    expect(() => reduceMarket(next, [invalid], "15m")).toThrow("invalid_candle");
  });
});
describe("account snapshots", () => {
  it("accepts SSE timestamps from portfolio and nullable equity", () => {
    const data = account();
    const wire = { ...data, checkedAt: undefined };
    expect(parseAccount(wire).checkedAt).toBe(data.portfolio?.checkedAt);
  });
  it("rejects malformed records before rendering", () => {
    expect(() =>
      parseAccount({
        ...account(),
        strategies: [{ strategyId: "x", paused: "false", reason: "test" }]
      })
    ).toThrow();
    expect(() => parseAccount({ ...account(), orders: [null] })).toThrow();
    expect(() =>
      parseAccount({ ...account(), portfolio: { ...account().portfolio, equity: "NaN" } })
    ).toThrow();
  });
});
