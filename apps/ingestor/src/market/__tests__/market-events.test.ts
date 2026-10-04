import { describe, expect, it } from "vitest";
import { normalizeMarketStreamEvent } from "../market-events.js";

describe("normalizeMarketStreamEvent", () => {
  it("validates and normalizes trade stream events", () => {
    const event = normalizeMarketStreamEvent({
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
    });

    expect(event.kind).toBe("trade");
    expect(event.symbol).toBe("BTCUSDT");
    expect(event.eventId).toBe("12345");
    expect(event.occurredAtMs).toBe(1_700_000_000_000);

    if (event.kind !== "trade") {
      throw new Error("expected trade event");
    }

    expect(event.trade.tradeId).toBe("12345");
    expect(event.trade.price.toString()).toBe("100.1");
    expect(event.trade.quantity.toString()).toBe("0.02");
    expect(event.trade.isBuyerMaker).toBe(true);
  });

  it("normalizes trade stream events when optional order ids are absent", () => {
    const event = normalizeMarketStreamEvent({
      e: "trade",
      E: 1_700_000_000_000,
      s: "BTCUSDT",
      t: 12345,
      p: "100.10",
      q: "0.0200",
      T: 1_700_000_000_001,
      m: true,
      M: true
    });

    expect(event.kind).toBe("trade");
    expect(event.eventId).toBe("12345");

    if (event.kind !== "trade") {
      throw new Error("expected trade event");
    }

    expect(event.trade.price.toString()).toBe("100.1");
    expect(event.trade.quantity.toString()).toBe("0.02");
  });

  it("validates and normalizes kline stream events", () => {
    const event = normalizeMarketStreamEvent({
      e: "kline",
      E: 1_700_000_060_000,
      s: "ETHUSDT",
      k: {
        t: 1_700_000_000_000,
        T: 1_700_000_059_999,
        s: "ETHUSDT",
        i: "1m",
        f: 100,
        L: 125,
        o: "2000.00",
        c: "2001.25",
        h: "2002.50",
        l: "1999.75",
        v: "12.345",
        n: 26,
        x: true,
        q: "24690.00",
        V: "6.000",
        Q: "12000.00",
        B: "0"
      }
    });

    expect(event.kind).toBe("kline");
    expect(event.symbol).toBe("ETHUSDT");
    expect(event.eventId).toBe("1m:1700000000000");
    expect(event.occurredAtMs).toBe(1_700_000_060_000);

    if (event.kind !== "kline") {
      throw new Error("expected kline event");
    }

    expect(event.candle.interval).toBe("1m");
    expect(event.candle.openTimeMs).toBe(1_700_000_000_000);
    expect(event.candle.closeTimeMs).toBe(1_700_000_059_999);
    expect(event.candle.close.toString()).toBe("2001.25");
    expect(event.candle.closed).toBe(true);
  });

  it("validates and normalizes depth stream events", () => {
    const event = normalizeMarketStreamEvent({
      e: "depthUpdate",
      E: 1_700_000_000_500,
      s: "BNBUSDT",
      U: 10,
      u: 12,
      b: [
        ["300.10", "1.50"],
        ["300.00", "0.00"]
      ],
      a: [["301.20", "2.25"]]
    });

    expect(event.kind).toBe("depth");
    expect(event.symbol).toBe("BNBUSDT");
    expect(event.eventId).toBe("12");
    expect(event.occurredAtMs).toBe(1_700_000_000_500);

    if (event.kind !== "depth") {
      throw new Error("expected depth event");
    }

    expect(event.depth.firstUpdateId).toBe(10);
    expect(event.depth.finalUpdateId).toBe(12);
    expect(event.depth.bids).toHaveLength(2);
    expect(event.depth.bids[0]?.price.toString()).toBe("300.1");
    expect(event.depth.bids[0]?.quantity.toString()).toBe("1.5");
    expect(event.depth.bids[1]?.quantity.toString()).toBe("0");
    expect(event.depth.asks[0]?.price.toString()).toBe("301.2");
  });

  it("rejects unknown event types before normalization", () => {
    expect(() =>
      normalizeMarketStreamEvent({
        e: "aggTrade",
        E: 1,
        s: "BTCUSDT"
      })
    ).toThrow();
  });

  it("rejects malformed decimal strings before publishing", () => {
    expect(() =>
      normalizeMarketStreamEvent({
        e: "trade",
        E: 1_700_000_000_000,
        s: "BTCUSDT",
        t: 12345,
        p: "not-a-decimal",
        q: "0.0200",
        b: 1,
        a: 2,
        T: 1_700_000_000_001,
        m: true,
        M: true
      })
    ).toThrow();
  });

  it("rejects mismatched kline symbols", () => {
    expect(() =>
      normalizeMarketStreamEvent({
        e: "kline",
        E: 1_700_000_060_000,
        s: "ETHUSDT",
        k: {
          t: 1_700_000_000_000,
          T: 1_700_000_059_999,
          s: "BTCUSDT",
          i: "1m",
          f: 100,
          L: 125,
          o: "2000.00",
          c: "2001.25",
          h: "2002.50",
          l: "1999.75",
          v: "12.345",
          n: 26,
          x: true,
          q: "24690.00",
          V: "6.000",
          Q: "12000.00",
          B: "0"
        }
      })
    ).toThrow();
  });
});
