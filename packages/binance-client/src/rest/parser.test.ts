import { describe, expect, it } from "vitest";
import { parseDepthResponse, parseKlineResponse } from "./parsers.js";

describe("binance parsers", () => {
  it("parses depth prices and quantities as Decimal values", () => {
    const parsed = parseDepthResponse(
      "BTCUSDT",
      {
        lastUpdateId: 1,
        bids: [["100.10", "0.20"]],
        asks: [["101.10", "0.30"]]
      },
      123
    );

    expect(parsed.bids[0]?.price.toString()).toBe("100.1");
    expect(parsed.bids[0]?.quantity.toString()).toBe("0.2");
    expect(parsed.asks[0]?.price.toString()).toBe("101.1");
    expect(parsed.asks[0]?.quantity.toString()).toBe("0.3");
  });

  it("parses kline OHLCV values as Decimal values", () => {
    const parsed = parseKlineResponse("BTCUSDT", "1m", [
      1000,
      "1.10",
      "2.20",
      "0.90",
      "1.80",
      "10.50",
      1999,
      "18.90",
      7,
      "5.20",
      "9.36",
      "0"
    ]);

    expect(parsed.open.toString()).toBe("1.1");
    expect(parsed.high.toString()).toBe("2.2");
    expect(parsed.low.toString()).toBe("0.9");
    expect(parsed.close.toString()).toBe("1.8");
    expect(parsed.volume.toString()).toBe("10.5");
  });
});