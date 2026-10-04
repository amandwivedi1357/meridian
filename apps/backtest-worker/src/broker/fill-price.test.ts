import { describe, expect, it } from "vitest";
import { Decimal } from "@meridian/core";
import { calculateMarketFillPrice } from "./fill-price.js";

describe("calculateMarketFillPrice", () => {
  it("increases the price for buys and decreases it for sells", () => {
    expect(calculateMarketFillPrice(new Decimal(100), "BUY", new Decimal(10)).toString()).toBe(
      "100.1"
    );
    expect(calculateMarketFillPrice(new Decimal(100), "SELL", new Decimal(10)).toString()).toBe(
      "99.9"
    );
  });

  it.each(["BUY", "SELL"] as const)(
    "preserves the open price with zero slippage for %s",
    (side) => {
      const result = calculateMarketFillPrice(new Decimal("85321.12345678"), side, new Decimal(0));
      expect(result.toString()).toBe("85321.12345678");
      expect(result).toBeInstanceOf(Decimal);
    }
  );

  it("handles fractional basis points using decimal arithmetic", () => {
    expect(calculateMarketFillPrice(new Decimal(100), "BUY", new Decimal("0.125")).toString()).toBe(
      "100.00125"
    );
    expect(calculateMarketFillPrice(new Decimal("0.1"), "BUY", new Decimal(10)).toString()).toBe(
      "0.1001"
    );
    expect(calculateMarketFillPrice(new Decimal("0.1"), "SELL", new Decimal(10)).toString()).toBe(
      "0.0999"
    );
  });

  it("keeps sell prices positive just below the 100 percent slippage boundary", () => {
    expect(calculateMarketFillPrice(new Decimal(100), "SELL", new Decimal(9999)).toString()).toBe(
      "0.01"
    );
  });

  it.each(["0", "-1", "NaN", "Infinity", "-Infinity"])("rejects invalid open price %s", (value) => {
    expect(() => calculateMarketFillPrice(new Decimal(value), "BUY", new Decimal(10))).toThrow(
      "Open price must be finite and positive"
    );
  });

  it.each(["-0.01", "10000", "10001", "NaN", "Infinity", "-Infinity"])(
    "rejects invalid slippage %s",
    (value) => {
      expect(() => calculateMarketFillPrice(new Decimal(100), "SELL", new Decimal(value))).toThrow(
        "Slippage must be between 0 and 10000 bps"
      );
    }
  );
});
