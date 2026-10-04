import { describe, expect, it } from "vitest";
import { Decimal, type Fill } from "@meridian/core";
import { applyFill, type SimBrokerState } from "./fill-accounting.js";
import { createMarketFill } from "./market-fill.js";

function initialState(balance = "1000"): SimBrokerState {
  return {
    quoteBalance: new Decimal(balance),
    position: {
      symbol: "BTCUSDT",
      quantity: new Decimal(0),
      avgEntry: new Decimal(0),
      realizedPnl: new Decimal(0)
    }
  };
}

function fill(side: "BUY" | "SELL", quantity = "2", price = "100", fee = "0.2"): Fill {
  return {
    symbol: "BTCUSDT",
    side,
    quantity: new Decimal(quantity),
    price: new Decimal(price),
    fee: new Decimal(fee),
    feeAsset: "USDT",
    tsMs: 0
  };
}

describe("applyFill", () => {
  it("deducts buy fees and includes them in the average cost basis", () => {
    const state = applyFill(initialState(), fill("BUY"), "USDT");
    expect(state.quoteBalance.toString()).toBe("799.8");
    expect(state.position.quantity.toString()).toBe("2");
    expect(state.position.avgEntry.toString()).toBe("100.1");
    expect(state.position.realizedPnl.toString()).toBe("0");
  });

  it("weights successive buys by quantity including fees", () => {
    const first = applyFill(initialState(), fill("BUY", "1", "100", "0.1"), "USDT");
    const second = applyFill(first, fill("BUY", "1", "120", "0.12"), "USDT");
    expect(second.quoteBalance.toString()).toBe("779.78");
    expect(second.position.quantity.toString()).toBe("2");
    expect(second.position.avgEntry.toString()).toBe("110.11");
  });

  it("accounts for both buy and sell fees in a partial exit", () => {
    const bought = applyFill(initialState(), fill("BUY"), "USDT");
    const sold = applyFill(bought, fill("SELL", "0.5", "120", "0.06"), "USDT");
    expect(sold.quoteBalance.toString()).toBe("859.74");
    expect(sold.position.quantity.toString()).toBe("1.5");
    expect(sold.position.avgEntry.toString()).toBe("100.1");
    expect(sold.position.realizedPnl.toString()).toBe("9.89");
  });

  it("resets entry cost when flat and preserves realized PnL on re-entry", () => {
    const bought = applyFill(initialState(), fill("BUY"), "USDT");
    const sold = applyFill(bought, fill("SELL", "2", "110", "0.22"), "USDT");
    expect(sold.quoteBalance.toString()).toBe("1019.58");
    expect(sold.position.quantity.toString()).toBe("0");
    expect(sold.position.avgEntry.toString()).toBe("0");
    expect(sold.position.realizedPnl.toString()).toBe("19.58");
    const reopened = applyFill(sold, fill("BUY", "1", "90", "0.09"), "USDT");
    expect(reopened.quoteBalance.toString()).toBe("929.49");
    expect(reopened.position.avgEntry.toString()).toBe("90.09");
    expect(reopened.position.realizedPnl.toString()).toBe("19.58");
  });

  it("rejects a buy when cash covers the notional but not its fee", () => {
    expect(() => applyFill(initialState("200"), fill("BUY"), "USDT")).toThrow(
      "Insufficient quote balance"
    );
  });

  it("allows spending the exact available balance including fees", () => {
    const state = applyFill(initialState("200.2"), fill("BUY"), "USDT");
    expect(state.quoteBalance.isZero()).toBe(true);
    expect(state.position.quantity.toString()).toBe("2");
  });

  it("rejects selling while flat or selling more than held", () => {
    expect(() => applyFill(initialState(), fill("SELL"), "USDT")).toThrow(
      "Insufficient base balance"
    );
    const bought = applyFill(initialState(), fill("BUY"), "USDT");
    expect(() => applyFill(bought, fill("SELL", "3"), "USDT")).toThrow("Insufficient base balance");
  });

  it.each([{ symbol: "ETHUSDT" }, { feeAsset: "BTC" }])(
    "rejects mismatched fill assets %j",
    (override) => {
      expect(() => applyFill(initialState(), { ...fill("BUY"), ...override }, "USDT")).toThrow(
        "Fill does not match broker assets"
      );
    }
  );

  it("leaves the input state unchanged on success and rejection", () => {
    const original = initialState();
    Object.freeze(original);
    Object.freeze(original.position);
    const updated = applyFill(original, fill("BUY"), "USDT");
    expect(updated).not.toBe(original);
    expect(updated.position).not.toBe(original.position);
    expect(() => applyFill(original, fill("SELL"), "USDT")).toThrow();
    expect(original.quoteBalance.toString()).toBe("1000");
    expect(original.position.quantity.toString()).toBe("0");
    expect(original.position.avgEntry.toString()).toBe("0");
  });

  it("conserves cash through a zero-fee round trip at the same price", () => {
    const bought = applyFill(initialState(), fill("BUY", "2", "100", "0"), "USDT");
    const sold = applyFill(bought, fill("SELL", "2", "100", "0"), "USDT");
    expect(sold.quoteBalance.toString()).toBe("1000");
    expect(sold.position.realizedPnl.toString()).toBe("0");
  });

  it("accounts for slippage and fees exactly in a same-open-price round trip", () => {
    const options = {
      symbol: "BTCUSDT",
      quoteAsset: "USDT",
      slippageBps: new Decimal(10),
      takerFeeRate: new Decimal("0.001")
    };
    const intent = {
      symbol: "BTCUSDT",
      side: "BUY" as const,
      type: "MARKET" as const,
      quantity: new Decimal(1),
      reason: "test"
    };
    const buy = createMarketFill(intent, new Decimal(100), 0, options);
    const sell = createMarketFill({ ...intent, side: "SELL" }, new Decimal(100), 1, options);
    const bought = applyFill(initialState(), buy, "USDT");
    const sold = applyFill(bought, sell, "USDT");
    expect(sold.quoteBalance.toString()).toBe("999.6");
    expect(sold.position.realizedPnl.toString()).toBe("-0.4");
    expect(sold.position.quantity.isZero()).toBe(true);
  });
});
