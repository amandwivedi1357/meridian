import { describe, expect, it } from "vitest";
import { Decimal, type Fill } from "@meridian/core";
import { applyFill, type SimBrokerState } from "./fill-accounting.js";
import { createMarketFill } from "./market-fill.js";

function initialState(balance = "1000"): SimBrokerState {
  return {
    quoteBalance: new Decimal(balance),
    feeBalances: new Map([["BNB", new Decimal("1")]]),
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
    const state = applyFill(initialState(), fill("BUY"), "USDT", "BTC");
    expect(state.quoteBalance.toString()).toBe("799.8");
    expect(state.position.quantity.toString()).toBe("2");
    expect(state.position.avgEntry.toString()).toBe("100.1");
    expect(state.position.realizedPnl.toString()).toBe("0");
  });

  it("weights successive buys by quantity including fees", () => {
    const first = applyFill(initialState(), fill("BUY", "1", "100", "0.1"), "USDT", "BTC");
    const second = applyFill(first, fill("BUY", "1", "120", "0.12"), "USDT", "BTC");
    expect(second.quoteBalance.toString()).toBe("779.78");
    expect(second.position.quantity.toString()).toBe("2");
    expect(second.position.avgEntry.toString()).toBe("110.11");
  });

  it("accounts for both buy and sell fees in a partial exit", () => {
    const bought = applyFill(initialState(), fill("BUY"), "USDT", "BTC");
    const sold = applyFill(bought, fill("SELL", "0.5", "120", "0.06"), "USDT", "BTC");
    expect(sold.quoteBalance.toString()).toBe("859.74");
    expect(sold.position.quantity.toString()).toBe("1.5");
    expect(sold.position.avgEntry.toString()).toBe("100.1");
    expect(sold.position.realizedPnl.toString()).toBe("9.89");
  });

  it("resets entry cost when flat and preserves realized PnL on re-entry", () => {
    const bought = applyFill(initialState(), fill("BUY"), "USDT", "BTC");
    const sold = applyFill(bought, fill("SELL", "2", "110", "0.22"), "USDT", "BTC");
    expect(sold.quoteBalance.toString()).toBe("1019.58");
    expect(sold.position.quantity.toString()).toBe("0");
    expect(sold.position.avgEntry.toString()).toBe("0");
    expect(sold.position.realizedPnl.toString()).toBe("19.58");
    const reopened = applyFill(sold, fill("BUY", "1", "90", "0.09"), "USDT", "BTC");
    expect(reopened.quoteBalance.toString()).toBe("929.49");
    expect(reopened.position.avgEntry.toString()).toBe("90.09");
    expect(reopened.position.realizedPnl.toString()).toBe("19.58");
  });

  it("rejects a buy when cash covers the notional but not its fee", () => {
    expect(() => applyFill(initialState("200"), fill("BUY"), "USDT", "BTC")).toThrow(
      "Insufficient quote balance"
    );
  });

  it("allows spending the exact available balance including fees", () => {
    const state = applyFill(initialState("200.2"), fill("BUY"), "USDT", "BTC");
    expect(state.quoteBalance.isZero()).toBe(true);
    expect(state.position.quantity.toString()).toBe("2");
  });

  it("rejects selling while flat or selling more than held", () => {
    expect(() => applyFill(initialState(), fill("SELL"), "USDT", "BTC")).toThrow(
      "Insufficient base balance"
    );
    const bought = applyFill(initialState(), fill("BUY"), "USDT", "BTC");
    expect(() => applyFill(bought, fill("SELL", "3"), "USDT", "BTC")).toThrow("Insufficient base balance");
  });

  it("rejects fills for a different symbol", () => {
    expect(() => applyFill(initialState(), { ...fill("BUY"), symbol: "ETHUSDT" }, "USDT", "BTC")).toThrow(
      "Fill does not match broker symbol"
    );
  });

  it("nets base-asset fees from bought quantity without charging quote fees", () => {
    const state = applyFill(
      initialState(),
      { ...fill("BUY", "2", "100", "0.01"), feeAsset: "BTC" },
      "USDT",
      "BTC"
    );

    expect(state.quoteBalance.toString()).toBe("800");
    expect(state.position.quantity.toString()).toBe("1.99");
    expect(state.position.avgEntry.toString()).toBe("100.50251256281407035");
    expect(state.position.realizedPnl.toString()).toBe("0");
  });

  it("deducts base-asset sell fees from position and realized PnL", () => {
    const bought = applyFill(
      initialState(),
      { ...fill("BUY", "2", "100", "0"), feeAsset: "USDT" },
      "USDT",
      "BTC"
    );
    const sold = applyFill(
      bought,
      { ...fill("SELL", "0.5", "120", "0.01"), feeAsset: "BTC" },
      "USDT",
      "BTC"
    );

    expect(sold.quoteBalance.toString()).toBe("860");
    expect(sold.position.quantity.toString()).toBe("1.49");
    expect(sold.position.avgEntry.toString()).toBe("100");
    expect(sold.position.realizedPnl.toString()).toBe("9");
  });

  it("rejects a base-fee sell when the held quantity only covers the sold quantity", () => {
    const bought = applyFill(
      initialState(),
      { ...fill("BUY", "1", "100", "0"), feeAsset: "USDT" },
      "USDT",
      "BTC"
    );

    expect(() =>
      applyFill(bought, { ...fill("SELL", "1", "120", "0.01"), feeAsset: "BTC" }, "USDT", "BTC")
    ).toThrow("Insufficient base balance");
  });

  it("deducts external fee assets without changing quote or base trade accounting", () => {
    const state = applyFill(
      initialState(),
      { ...fill("BUY", "2", "100", "0.005"), feeAsset: "BNB" },
      "USDT",
      "BTC"
    );

    expect(state.quoteBalance.toString()).toBe("800");
    expect(state.position.quantity.toString()).toBe("2");
    expect(state.position.avgEntry.toString()).toBe("100");
    expect(state.feeBalances.get("BNB")?.toString()).toBe("0.995");
  });

  it("rejects external fee assets without enough fee balance", () => {
    expect(() =>
      applyFill(
        {
          ...initialState(),
          feeBalances: new Map([["BNB", new Decimal("0.001")]])
        },
        { ...fill("BUY", "2", "100", "0.005"), feeAsset: "BNB" },
        "USDT",
        "BTC"
      )
    ).toThrow("Insufficient BNB fee balance");
  });

  it("rejects unsupported external fee assets", () => {
    expect(() =>
      applyFill(
        initialState(),
        { ...fill("BUY", "2", "100", "0.005"), feeAsset: "FDUSD" },
        "USDT",
        "BTC"
      )
    ).toThrow("Unsupported fee asset");
  });

  it("leaves the input state unchanged on success and rejection", () => {
    const original = initialState();
    Object.freeze(original);
    Object.freeze(original.position);
    const updated = applyFill(original, fill("BUY"), "USDT", "BTC");
    expect(updated).not.toBe(original);
    expect(updated.position).not.toBe(original.position);
    expect(() => applyFill(original, fill("SELL"), "USDT", "BTC")).toThrow();
    expect(original.quoteBalance.toString()).toBe("1000");
    expect(original.position.quantity.toString()).toBe("0");
    expect(original.position.avgEntry.toString()).toBe("0");
  });

  it("conserves cash through a zero-fee round trip at the same price", () => {
    const bought = applyFill(initialState(), fill("BUY", "2", "100", "0"), "USDT", "BTC");
    const sold = applyFill(bought, fill("SELL", "2", "100", "0"), "USDT", "BTC");
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
    const bought = applyFill(initialState(), buy, "USDT", "BTC");
    const sold = applyFill(bought, sell, "USDT", "BTC");
    expect(sold.quoteBalance.toString()).toBe("999.6");
    expect(sold.position.realizedPnl.toString()).toBe("-0.4");
    expect(sold.position.quantity.isZero()).toBe(true);
  });
});
