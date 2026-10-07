import { Decimal, type Candle, type OrderIntent, type Position } from "@meridian/core";
import { describe, expect, it, vi } from "vitest";

import { createSimExchangeGateway } from "./sim-exchange-gateway.js";
import type { SimBroker, SimulatedFill } from "./sim-broker.js";
import { createSimBroker } from "./create-sim-broker.js";

function candle(openTimeMs: number): Candle {
  return {
    symbol: "BTCUSDT",
    interval: "15m",
    openTimeMs,
    closeTimeMs: openTimeMs + 899_999,
    open: new Decimal("100"),
    high: new Decimal("110"),
    low: new Decimal("90"),
    close: new Decimal("105"),
    volume: new Decimal("1"),
    closed: true
  };
}

function fill(side: "BUY" | "SELL" = "BUY"): SimulatedFill {
  return {
    clientOrderId: "sim-4",
    symbol: "BTCUSDT",
    side,
    quantity: new Decimal("0.5"),
    price: new Decimal("100"),
    fee: new Decimal("0.05"),
    feeAsset: "USDT",
    tsMs: 1_000
  };
}

function position(): Position {
  return {
    symbol: "BTCUSDT",
    quantity: new Decimal("0.5"),
    avgEntry: new Decimal("100"),
    realizedPnl: new Decimal("0")
  };
}

function createBroker(overrides: Partial<SimBroker> = {}) {
  const broker: SimBroker = {
    submit: vi.fn(),
    processCandle: vi.fn(() => []),
    position: vi.fn(position),
    balance: vi.fn((asset) => {
      if (asset === "USDT") return new Decimal("1000");
      if (asset === "BTC") return new Decimal("0.5");
      return new Decimal("0");
    }),
    equity: vi.fn(() => new Decimal("1050")),
    ...overrides
  };

  return broker;
}

describe("createSimExchangeGateway", () => {
  it("keeps the untouched same-side limit open and records the actual filled order", async () => {
    const broker = createSimBroker({
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      initialQuoteBalance: new Decimal(1000),
      slippageBps: new Decimal(0),
      takerFeeRate: new Decimal(0)
    });
    const gateway = createSimExchangeGateway({
      broker,
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      nowMs: () => 0
    });
    for (const [clientOrderId, price] of [
      ["untouched", "50"],
      ["touched", "100"]
    ] as const) {
      await gateway.placeOrder({
        clientOrderId,
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        quantity: new Decimal("0.5"),
        price: new Decimal(price)
      });
    }
    expect(gateway.processCandle(candle(1000))[0]).toMatchObject({
      clientOrderId: "touched",
      price: new Decimal(100)
    });
    expect((await gateway.getOpenOrders()).map((order) => order.clientOrderId)).toEqual([
      "untouched"
    ]);
    expect(await gateway.getOrder({ symbol: "BTCUSDT", clientOrderId: "touched" })).toMatchObject({
      status: "FILLED",
      executedQuantity: new Decimal("0.5"),
      cumulativeQuoteQuantity: new Decimal(50)
    });
    expect(gateway.processCandle({ ...candle(2000), low: new Decimal(40) })[0]).toMatchObject({
      clientOrderId: "untouched"
    });
    expect(await gateway.getOpenOrders()).toEqual([]);
  });

  it("rejects duplicate ids before queuing another simulated order", async () => {
    const broker = createBroker();
    const gateway = createSimExchangeGateway({
      broker,
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT"
    });
    const request = {
      clientOrderId: "duplicate",
      symbol: "BTCUSDT",
      side: "BUY" as const,
      type: "MARKET" as const,
      quantity: new Decimal(1)
    };
    await gateway.placeOrder(request);
    await expect(gateway.placeOrder(request)).rejects.toThrow(
      "Duplicate simulated client order id"
    );
    expect(broker.submit).toHaveBeenCalledOnce();
  });

  it("fails closed instead of guessing the identity of an untagged fill", async () => {
    const { clientOrderId: removedId, ...untagged } = fill();
    expect(removedId).toBe("sim-4");
    const broker = createBroker({ processCandle: () => [untagged] });
    const gateway = createSimExchangeGateway({
      broker,
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT"
    });
    expect(() => gateway.processCandle(candle(1000))).toThrow(
      "Simulated fill order identity mismatch"
    );
  });
  it("submits market orders to the simulated broker and tracks them as open", async () => {
    const broker = createBroker();
    const gateway = createSimExchangeGateway({
      broker,
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      nowMs: () => 123
    });

    const result = await gateway.placeOrder({
      clientOrderId: "sim-1",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: new Decimal("0.5")
    });

    const expectedIntent: OrderIntent = {
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: new Decimal("0.5"),
      reason: "sim-1"
    };

    expect(broker.submit).toHaveBeenCalledWith(expectedIntent, 123, "sim-1");
    expect(result).toMatchObject({
      clientOrderId: "sim-1",
      exchangeOrderId: "sim:sim-1",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      status: "NEW",
      eventTimeMs: 123
    });

    const openOrders = await gateway.getOpenOrders();
    expect(openOrders).toHaveLength(1);
    expect(openOrders[0]?.clientOrderId).toBe("sim-1");
  });

  it("submits limit orders with the requested limit price", async () => {
    const broker = createBroker();
    const gateway = createSimExchangeGateway({
      broker,
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      nowMs: () => 123
    });

    await gateway.placeOrder({
      clientOrderId: "sim-2",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "LIMIT",
      quantity: new Decimal("0.5"),
      price: new Decimal("101")
    });

    expect(broker.submit).toHaveBeenCalledWith(
      {
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        quantity: new Decimal("0.5"),
        limitPrice: new Decimal("101"),
        reason: "sim-2"
      },
      123,
      "sim-2"
    );
  });

  it("rejects limit orders without a price before submitting", async () => {
    const broker = createBroker();
    const gateway = createSimExchangeGateway({
      broker,
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT"
    });

    await expect(
      gateway.placeOrder({
        clientOrderId: "sim-3",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        quantity: new Decimal("0.5")
      })
    ).rejects.toThrow("Limit order price is required");
    expect(broker.submit).not.toHaveBeenCalled();
  });

  it("processes candles through the broker and clears matching filled open orders", async () => {
    const broker = createBroker({
      processCandle: vi.fn(() => [fill()])
    });
    const gateway = createSimExchangeGateway({
      broker,
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      nowMs: () => 123
    });

    await gateway.placeOrder({
      clientOrderId: "sim-4",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: new Decimal("0.5")
    });

    expect(gateway.processCandle(candle(1_000))).toEqual([fill()]);
    expect(broker.processCandle).toHaveBeenCalledWith(candle(1_000));
    await expect(gateway.getOpenOrders()).resolves.toEqual([]);
  });

  it("reads balances and positions from the simulated broker", async () => {
    const broker = createBroker();
    const gateway = createSimExchangeGateway({
      broker,
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      balanceAssets: ["BNB"]
    });

    await expect(gateway.getBalances()).resolves.toEqual([
      { asset: "USDT", free: new Decimal("1000"), locked: new Decimal("0") },
      { asset: "BTC", free: new Decimal("0.5"), locked: new Decimal("0") },
      { asset: "BNB", free: new Decimal("0"), locked: new Decimal("0") }
    ]);
    expect(gateway.position()).toEqual(position());
  });

  it("rejects cancellation because the current sim broker has no cancel primitive", async () => {
    const broker = createBroker();
    const gateway = createSimExchangeGateway({
      broker,
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT"
    });

    await expect(
      gateway.cancelOrder({ symbol: "BTCUSDT", clientOrderId: "sim-5" })
    ).rejects.toThrow("Simulated exchange gateway does not support cancellation");
  });
});
