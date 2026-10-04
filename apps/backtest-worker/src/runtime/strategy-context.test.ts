import { describe, expect, it, vi } from "vitest";
import { Decimal, type Candle, type OrderIntent } from "@meridian/core";
import { createSimBroker } from "../broker/create-sim-broker.js";
import { createBacktestContext } from "./strategy-context.js";

function broker() {
  return createSimBroker({
    symbol: "BTCUSDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    initialQuoteBalance: new Decimal(1000),
    slippageBps: new Decimal(0),
    takerFeeRate: new Decimal(0)
  });
}
function candle(openTimeMs: number): Candle {
  return {
    symbol: "BTCUSDT",
    interval: "15m",
    openTimeMs,
    closeTimeMs: openTimeMs + 899999,
    open: new Decimal(100),
    high: new Decimal(100),
    low: new Decimal(100),
    close: new Decimal(100),
    volume: new Decimal(1),
    closed: true
  };
}
const intent: OrderIntent = {
  symbol: "BTCUSDT",
  side: "BUY",
  type: "MARKET",
  quantity: new Decimal(1),
  reason: "signal"
};

describe("createBacktestContext", () => {
  it("reads the supplied clock dynamically instead of capturing initial or wall-clock time", () => {
    let simulatedTime = 100;
    const context = createBacktestContext(broker(), () => simulatedTime);
    expect(context.now()).toBe(100);
    simulatedTime = 200;
    expect(context.now()).toBe(200);
  });

  it("timestamps submissions with the current simulated time", () => {
    const simBroker = broker();
    const context = createBacktestContext(simBroker, () => 100);
    context.submit(intent);
    expect(simBroker.processCandle(candle(100))).toEqual([]);
    expect(simBroker.processCandle(candle(101))).toHaveLength(1);
  });

  it("exposes current broker balances and positions after a fill", () => {
    const simBroker = broker();
    const context = createBacktestContext(simBroker, () => 0);
    expect(context.balance("USDT").toString()).toBe("1000");
    expect(context.position("BTCUSDT").quantity.isZero()).toBe(true);
    context.submit(intent);
    simBroker.processCandle(candle(1));
    expect(context.balance("USDT").toString()).toBe("900");
    expect(context.balance("BTC").toString()).toBe("1");
    expect(context.position("BTCUSDT").quantity.toString()).toBe("1");
  });

  it("rejects requesting a position for another symbol", () => {
    const context = createBacktestContext(broker(), () => 0);
    expect(() => context.position("ETHUSDT")).toThrow("Unsupported strategy symbol");
  });

  it("propagates broker submission validation", () => {
    const context = createBacktestContext(broker(), () => 0);
    expect(() => context.submit({ ...intent, quantity: new Decimal(0) })).toThrow(
      "Quantity must be finite and positive"
    );
  });

  it("forwards logs to an injected logger and supports a silent default", () => {
    const log = vi.fn();
    const context = createBacktestContext(broker(), () => 0, log);
    context.log("signal", { side: "BUY" });
    expect(log).toHaveBeenCalledWith("signal", { side: "BUY" });
    expect(() => createBacktestContext(broker(), () => 0).log("signal")).not.toThrow();
  });
});
