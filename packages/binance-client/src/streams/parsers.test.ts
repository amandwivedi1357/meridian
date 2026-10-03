import { describe, expect, it } from "vitest";
import { parseKlineStreamPayload, parseTradeStreamPayload } from "./parsers.js";

describe("stream parsers", () => {
  it("parses trade stream payloads into Decimal trade values", () => {
    const parsed = parseTradeStreamPayload({
      e: "trade",
      E: 1000,
      s: "BTCUSDT",
      t: 123,
      p: "100.10",
      q: "0.20",
      b: 1,
      a: 2,
      T: 999,
      m: true,
      M: true
    });

    expect(parsed.symbol).toBe("BTCUSDT");
    expect(parsed.tradeId).toBe("123");
    expect(parsed.price.toString()).toBe("100.1");
    expect(parsed.quantity.toString()).toBe("0.2");
    expect(parsed.eventTimeMs).toBe(1000);
    expect(parsed.isBuyerMaker).toBe(true);
  });

  it("parses kline stream payloads into Decimal candle values", () => {
    const parsed = parseKlineStreamPayload({
      e: "kline",
      E: 2000,
      s: "ETHUSDT",
      k: {
        t: 1000,
        T: 1999,
        s: "ETHUSDT",
        i: "1m",
        f: 1,
        L: 2,
        o: "10.10",
        c: "11.20",
        h: "12.30",
        l: "9.40",
        v: "100.50",
        n: 10,
        x: true,
        q: "1000.00",
        V: "50.00",
        Q: "500.00",
        B: "0"
      }
    });

    expect(parsed.symbol).toBe("ETHUSDT");
    expect(parsed.interval).toBe("1m");
    expect(parsed.open.toString()).toBe("10.1");
    expect(parsed.high.toString()).toBe("12.3");
    expect(parsed.low.toString()).toBe("9.4");
    expect(parsed.close.toString()).toBe("11.2");
    expect(parsed.volume.toString()).toBe("100.5");
    expect(parsed.closed).toBe(true);
  });
});
