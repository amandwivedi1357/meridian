import { describe, expect, it } from "vitest";
import { Decimal } from "@meridian/core";
import type { SimBrokerOptions } from "./sim-broker.js";
import { validateSimBrokerOptions } from "./broker-options.js";

function options(): SimBrokerOptions {
  return {
    symbol: "BTCUSDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    initialQuoteBalance: new Decimal(1000),
    slippageBps: new Decimal(10),
    takerFeeRate: new Decimal("0.001")
  };
}

describe("validateSimBrokerOptions", () => {
  it("accepts matching Spot assets and valid balances, fees, and slippage", () => {
    expect(() => validateSimBrokerOptions(options())).not.toThrow();
    expect(() =>
      validateSimBrokerOptions({
        ...options(),
        symbol: "ETHUSDT",
        baseAsset: "ETH",
        slippageBps: new Decimal(0),
        takerFeeRate: new Decimal(0)
      })
    ).not.toThrow();
  });

  it.each([
    { symbol: "ETHUSDT" },
    { baseAsset: "" },
    { baseAsset: " " },
    { quoteAsset: "" },
    { quoteAsset: " " },
    { symbol: "BTCBTC", baseAsset: "BTC", quoteAsset: "BTC" }
  ])("rejects invalid asset configuration %j", (override) => {
    expect(() => validateSimBrokerOptions({ ...options(), ...override })).toThrow(
      "Invalid broker asset configuration"
    );
  });

  it.each(["0", "-1", "NaN", "Infinity"])("rejects invalid starting balance %s", (balance) => {
    expect(() =>
      validateSimBrokerOptions({ ...options(), initialQuoteBalance: new Decimal(balance) })
    ).toThrow("Initial quote balance must be finite and positive");
  });

  it.each(["-0.001", "1", "NaN", "Infinity"])("rejects invalid taker fee %s", (rate) => {
    expect(() =>
      validateSimBrokerOptions({ ...options(), takerFeeRate: new Decimal(rate) })
    ).toThrow("Fee rate must be between 0 and 1");
  });

  it.each(["-1", "10000", "NaN", "Infinity"])("rejects invalid slippage %s", (bps) => {
    expect(() => validateSimBrokerOptions({ ...options(), slippageBps: new Decimal(bps) })).toThrow(
      "Slippage must be between 0 and 10000 bps"
    );
  });
});
