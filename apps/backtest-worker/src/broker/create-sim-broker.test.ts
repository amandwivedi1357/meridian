import { describe, expect, it } from "vitest";
import { Decimal, type Candle, type OrderIntent } from "@meridian/core";
import { createSimBroker } from "./create-sim-broker.js";
import type { SimBrokerOptions } from "./sim-broker.js";

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

function candle(openTimeMs: number, open = "100"): Candle {
  return {
    symbol: "BTCUSDT",
    interval: "15m",
    openTimeMs,
    closeTimeMs: openTimeMs + 899999,
    open: new Decimal(open),
    high: new Decimal(150),
    low: new Decimal(50),
    close: new Decimal(120),
    volume: new Decimal(1),
    closed: true
  };
}

function order(side: "BUY" | "SELL" = "BUY", quantity = "1"): OrderIntent {
  return {
    symbol: "BTCUSDT",
    side,
    type: "MARKET",
    quantity: new Decimal(quantity),
    reason: "test"
  };
}

describe("createSimBroker", () => {
  it("starts flat with quote cash and marks equity without holdings", () => {
    const broker = createSimBroker(options());
    expect(broker.balance("USDT").toString()).toBe("1000");
    expect(broker.balance("BTC").isZero()).toBe(true);
    expect(broker.balance("ETH").isZero()).toBe(true);
    expect(broker.position().avgEntry.isZero()).toBe(true);
    expect(broker.equity(new Decimal(100)).toString()).toBe("1000");
  });

  it("fills an order after candle N closes at candle N+1's open, not its close", () => {
    const broker = createSimBroker(options());
    expect(broker.processCandle(candle(0))).toEqual([]);
    broker.submit(order(), 899999);
    const fills = broker.processCandle(candle(900000));
    expect(fills).toHaveLength(1);
    expect(fills[0]?.tsMs).toBe(900000);
    expect(fills[0]?.price.toString()).toBe("100.1");
    expect(fills[0]?.fee.toString()).toBe("0.1001");
    expect(broker.balance("USDT").toString()).toBe("899.7999");
    expect(broker.balance("BTC").toString()).toBe("1");
    expect(broker.position().avgEntry.toString()).toBe("100.2001");
    expect(broker.equity(new Decimal(120)).toString()).toBe("1019.7999");
    expect(broker.processCandle(candle(1800000))).toEqual([]);
  });

  it("does not execute orders submitted at or after a candle's open", () => {
    const broker = createSimBroker(options());
    broker.submit(order(), 100);
    expect(broker.processCandle(candle(100))).toEqual([]);
    expect(broker.processCandle(candle(101))).toHaveLength(1);
  });

  it("completes a fee-and-slippage-aware buy/sell round trip", () => {
    const broker = createSimBroker(options());
    broker.submit(order(), 0);
    broker.processCandle(candle(1));
    broker.submit(order("SELL"), 1);
    broker.processCandle(candle(2));
    expect(broker.balance("USDT").toString()).toBe("999.6");
    expect(broker.position().quantity.isZero()).toBe(true);
    expect(broker.position().avgEntry.isZero()).toBe(true);
    expect(broker.position().realizedPnl.toString()).toBe("-0.4");
  });

  it.each([{ closed: false }, { symbol: "ETHUSDT" }])(
    "ignores irrelevant candles without draining orders %j",
    (override) => {
      const broker = createSimBroker(options());
      broker.submit(order(), 0);
      expect(broker.processCandle({ ...candle(1), ...override })).toEqual([]);
      expect(broker.processCandle(candle(1))).toHaveLength(1);
    }
  );

  it("rejects duplicate or decreasing candle times before consuming pending orders", () => {
    const broker = createSimBroker(options());
    broker.processCandle(candle(100));
    broker.submit(order(), 100);
    expect(() => broker.processCandle(candle(100))).toThrow(
      "Candles must have increasing valid timestamps"
    );
    expect(() => broker.processCandle(candle(99))).toThrow(
      "Candles must have increasing valid timestamps"
    );
    expect(broker.processCandle(candle(101))).toHaveLength(1);
  });

  it.each([-1, 0.5, NaN, Infinity])("rejects invalid open timestamp %s", (timestamp) => {
    const broker = createSimBroker(options());
    broker.submit(order(), 0);
    expect(() => broker.processCandle(candle(timestamp))).toThrow(
      "Candles must have increasing valid timestamps"
    );
    expect(broker.processCandle(candle(1))).toHaveLength(1);
  });

  it("rejects retroactive submissions and orders that fail queue validation", () => {
    const broker = createSimBroker(options());
    broker.processCandle(candle(100));
    expect(() => broker.submit(order(), 99)).toThrow("Cannot submit an order in the past");
    expect(() => broker.submit(order("BUY", "0"), 100)).toThrow(
      "Quantity must be finite and positive"
    );
    expect(() => broker.submit({ ...order(), symbol: "ETHUSDT" }, 100)).toThrow(
      "Unsupported simulated order"
    );
    expect(broker.processCandle(candle(101))).toEqual([]);
  });

  it("leaves state uncommitted and halts when a later order in the same batch exceeds funds", () => {
    const broker = createSimBroker(options());
    broker.submit(order("BUY", "1"), 0);
    broker.submit(order("BUY", "10"), 0);
    expect(() => broker.processCandle(candle(1))).toThrow("Insufficient quote balance");
    expect(broker.balance("USDT").toString()).toBe("1000");
    expect(broker.position().quantity.isZero()).toBe(true);
    expect(() => broker.submit(order(), 2)).toThrow("Sim broker halted");
    expect(() => broker.processCandle(candle(2))).toThrow("Sim broker halted");
  });

  it("halts instead of allowing a short position", () => {
    const broker = createSimBroker(options());
    broker.submit(order("SELL"), 0);
    expect(() => broker.processCandle(candle(1))).toThrow("Insufficient base balance");
    expect(broker.position().quantity.isZero()).toBe(true);
  });

  it("rejects invalid prices before draining orders and invalid marks before computing equity", () => {
    const broker = createSimBroker(options());
    broker.submit(order(), 0);
    expect(() => broker.processCandle(candle(1, "0"))).toThrow(
      "Open price must be finite and positive"
    );
    expect(broker.processCandle(candle(1))).toHaveLength(1);
    expect(() => broker.equity(new Decimal("NaN"))).toThrow(
      "Open price must be finite and positive"
    );
  });

  it("snapshots configuration and returns a position copy", () => {
    const config = { ...options() };
    const broker = createSimBroker(config);
    config.symbol = "ETHUSDT";
    config.slippageBps = new Decimal(9999);
    const position = { ...broker.position() };
    position.quantity = new Decimal(100);
    broker.submit(order(), 0);
    expect(broker.processCandle(candle(1))[0]?.price.toString()).toBe("100.1");
    expect(broker.position().quantity.toString()).toBe("1");
  });

  it("rejects invalid configuration immediately", () => {
    expect(() => createSimBroker({ ...options(), initialQuoteBalance: new Decimal(0) })).toThrow(
      "Initial quote balance must be finite and positive"
    );
  });
});
