import { describe, expect, it } from "vitest";
import { Decimal, type OrderIntent } from "@meridian/core";
import { createMarketFill } from "./market-fill.js";

const options = {
  symbol: "BTCUSDT",
  quoteAsset: "USDT",
  slippageBps: new Decimal(10),
  takerFeeRate: new Decimal("0.001")
};
const timestamp = Date.UTC(2024, 0, 1);
const intent: OrderIntent = {
  symbol: "BTCUSDT",
  side: "BUY",
  type: "MARKET",
  quantity: new Decimal("0.5"),
  reason: "test signal"
};

describe("createMarketFill", () => {
  it("charges the buy fee on the slipped execution notional", () => {
    const fill = createMarketFill(intent, new Decimal(100), timestamp, options);
    expect(fill.price.toString()).toBe("100.1");
    expect(fill.fee.toString()).toBe("0.05005");
    expect(fill.feeAsset).toBe("USDT");
    expect(fill.quantity.toString()).toBe("0.5");
    expect(fill.symbol).toBe("BTCUSDT");
    expect(fill.side).toBe("BUY");
    expect(fill.tsMs).toBe(timestamp);
  });

  it("charges the sell fee on the lower slipped execution price", () => {
    const fill = createMarketFill(
      { ...intent, side: "SELL" },
      new Decimal(100),
      timestamp,
      options
    );
    expect(fill.price.toString()).toBe("99.9");
    expect(fill.fee.toString()).toBe("0.04995");
    expect(fill.side).toBe("SELL");
  });

  it("supports zero fees and zero slippage", () => {
    const fill = createMarketFill(intent, new Decimal(100), 0, {
      ...options,
      takerFeeRate: new Decimal(0),
      slippageBps: new Decimal(0)
    });
    expect(fill.price.toString()).toBe("100");
    expect(fill.fee.toString()).toBe("0");
    expect(fill.tsMs).toBe(0);
  });

  it("preserves small quantities and fees without float conversion", () => {
    const fill = createMarketFill(
      { ...intent, quantity: new Decimal("0.00000001") },
      new Decimal("0.1"),
      timestamp,
      options
    );
    expect(fill.price.toString()).toBe("0.1001");
    expect(fill.fee.toFixed()).toBe("0.000000000001001");
  });

  it.each([{ symbol: "ETHUSDT" }, { type: "LIMIT" as const, limitPrice: new Decimal(100) }])(
    "rejects unsupported orders %j",
    (override) => {
      expect(() =>
        createMarketFill({ ...intent, ...override }, new Decimal(100), timestamp, options)
      ).toThrow("Unsupported simulated order");
    }
  );

  it.each(["0", "-0.01", "NaN", "Infinity"])("rejects invalid quantity %s", (quantity) => {
    expect(() =>
      createMarketFill(
        { ...intent, quantity: new Decimal(quantity) },
        new Decimal(100),
        timestamp,
        options
      )
    ).toThrow("Quantity must be finite and positive");
  });

  it.each(["-0.001", "1", "2", "NaN", "Infinity"])("rejects invalid fee rate %s", (fee) => {
    expect(() =>
      createMarketFill(intent, new Decimal(100), timestamp, {
        ...options,
        takerFeeRate: new Decimal(fee)
      })
    ).toThrow("Fee rate must be between 0 and 1");
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid timestamp %s",
    (time) => {
      expect(() => createMarketFill(intent, new Decimal(100), time, options)).toThrow(
        "Invalid fill timestamp"
      );
    }
  );

  it("propagates fill-price validation and leaves the intent unchanged", () => {
    expect(() => createMarketFill(intent, new Decimal(0), timestamp, options)).toThrow(
      "Open price must be finite and positive"
    );
    expect(() =>
      createMarketFill(intent, new Decimal(100), timestamp, {
        ...options,
        slippageBps: new Decimal(-1)
      })
    ).toThrow("Slippage must be between 0 and 10000 bps");
    expect(intent.quantity.toString()).toBe("0.5");
    expect(intent.side).toBe("BUY");
  });
});
