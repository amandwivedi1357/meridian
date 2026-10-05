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
    takerFeeRate: new Decimal("0.001"),
    makerFeeRate: new Decimal("0.0002")
  };
}

function optionsWithFeeBalances(): SimBrokerOptions {
  return {
    ...options(),
    initialFeeBalances: new Map([["BNB", new Decimal("2")]])
  };
}

function optionsWithExchangeFilters(): SimBrokerOptions {
  return {
    ...options(),
    slippageBps: new Decimal(0),
    exchangeFilters: {
      tickSize: new Decimal("0.01"),
      stepSize: new Decimal("0.001"),
      minNotional: new Decimal("10")
    }
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

function limitOrder(side: "BUY" | "SELL", limitPrice: string, quantity = "1"): OrderIntent {
  return {
    ...order(side, quantity),
    type: "LIMIT",
    limitPrice: new Decimal(limitPrice)
  };
}

function stopMarketOrder(side: "BUY" | "SELL", stopPrice: string, quantity = "1"): OrderIntent {
  return {
    ...order(side, quantity),
    type: "STOP_MARKET",
    stopPrice: new Decimal(stopPrice)
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

  it("exposes configured external fee balances without adding them to quote equity", () => {
    const broker = createSimBroker(optionsWithFeeBalances());
    expect(broker.balance("BNB").toString()).toBe("2");
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

  it("applies exchange filters before accounting a market fill", () => {
    const broker = createSimBroker(optionsWithExchangeFilters());
    broker.submit(order("BUY", "0.123456"), 0);
    const fills = broker.processCandle(candle(1, "100.003"));

    expect(fills[0]?.price.toString()).toBe("100.01");
    expect(fills[0]?.quantity.toString()).toBe("0.123");
    expect(fills[0]?.fee.toString()).toBe("0.01230123");
    expect(broker.balance("BTC").toString()).toBe("0.123");
    expect(broker.balance("USDT").toString()).toBe("987.68646877");
  });

  it("keeps an untouched buy limit pending and fills it later at the limit price with maker fees", () => {
    const broker = createSimBroker(options());
    broker.submit(limitOrder("BUY", "95"), 0);

    expect(broker.processCandle({ ...candle(1, "100"), low: new Decimal(96) })).toEqual([]);
    const fills = broker.processCandle({ ...candle(2, "100"), low: new Decimal(94) });

    expect(fills).toHaveLength(1);
    expect(fills[0]?.price.toString()).toBe("95");
    expect(fills[0]?.quantity.toString()).toBe("1");
    expect(fills[0]?.fee.toString()).toBe("0.019");
    expect(broker.balance("BTC").toString()).toBe("1");
    expect(broker.balance("USDT").toString()).toBe("904.981");
  });

  it("requires trade-through before filling a limit order", () => {
    const broker = createSimBroker(options());
    broker.submit(limitOrder("BUY", "95"), 0);

    expect(broker.processCandle({ ...candle(1, "100"), low: new Decimal(95) })).toEqual([]);
    expect(broker.processCandle({ ...candle(2, "100"), low: new Decimal("94.99") })).toHaveLength(
      1
    );
  });

  it("fills a sell limit when the candle trades through the limit price", () => {
    const broker = createSimBroker(options());
    broker.submit(order("BUY"), 0);
    broker.processCandle(candle(1));
    broker.submit(limitOrder("SELL", "120"), 1);

    const fills = broker.processCandle({ ...candle(2, "100"), high: new Decimal(121) });

    expect(fills).toHaveLength(1);
    expect(fills[0]?.side).toBe("SELL");
    expect(fills[0]?.price.toString()).toBe("120");
    expect(fills[0]?.fee.toString()).toBe("0.024");
    expect(broker.balance("BTC").isZero()).toBe(true);
    expect(broker.position().realizedPnl.toString()).toBe("19.7759");
  });

  it("does not fill a touched limit order on the same candle open it was submitted at", () => {
    const broker = createSimBroker(options());
    broker.submit(limitOrder("BUY", "95"), 100);

    expect(broker.processCandle({ ...candle(100, "100"), low: new Decimal(94) })).toEqual([]);
    expect(broker.processCandle({ ...candle(101, "100"), low: new Decimal(94) })).toHaveLength(1);
  });

  it("fills the unfavourable stop before a favourable target when both are possible intrabar", () => {
    const broker = createSimBroker(options());
    broker.submit(order("BUY"), 0);
    broker.processCandle(candle(1));

    broker.submit(limitOrder("SELL", "120"), 1);
    broker.submit(stopMarketOrder("SELL", "90"), 1);

    const fills = broker.processCandle({
      ...candle(2, "100"),
      high: new Decimal(121),
      low: new Decimal(89)
    });

    expect(fills).toHaveLength(1);
    expect(fills[0]?.side).toBe("SELL");
    expect(fills[0]?.price.toString()).toBe("89.91");
    expect(broker.balance("BTC").isZero()).toBe(true);
    expect(broker.position().realizedPnl.toString()).toBe("-10.38001");
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
