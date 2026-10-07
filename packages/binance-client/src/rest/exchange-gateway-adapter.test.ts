import { Decimal, type BalanceSnapshot, type GatewayOrderRequest } from "@meridian/core";
import { describe, expect, it, vi } from "vitest";

import { createBinanceExchangeGateway } from "./exchange-gateway-adapter.js";
import type { BinanceOrderResponse } from "./order-schemas.js";

const filledMarketOrder: BinanceOrderResponse = {
  symbol: "BTCUSDT",
  orderId: 123,
  orderListId: -1,
  clientOrderId: "client-1",
  price: "0.00000000",
  origQty: "0.00100000",
  executedQty: "0.00100000",
  cummulativeQuoteQty: "85.00000000",
  status: "FILLED",
  timeInForce: "GTC",
  type: "MARKET",
  side: "BUY",
  transactTime: 2_000,
  fills: [
    {
      price: "85000.00000000",
      qty: "0.00100000",
      commission: "0.08500000",
      commissionAsset: "USDT",
      tradeId: 456
    }
  ]
};

function createClient(response: BinanceOrderResponse = filledMarketOrder) {
  return {
    placeOrder: vi.fn(async () => response),
    cancelOrder: vi.fn(async () => response),
    queryOrder: vi.fn(async () => response),
    openOrders: vi.fn(async () => [response])
  };
}

describe("createBinanceExchangeGateway", () => {
  it("places a market order through the Binance order client and maps the response", async () => {
    const client = createClient();
    const balances: readonly BalanceSnapshot[] = [
      { asset: "USDT", free: new Decimal("1000"), locked: new Decimal("0") }
    ];
    const gateway = createBinanceExchangeGateway({
      client,
      getBalances: async () => balances
    });

    const request: GatewayOrderRequest = {
      clientOrderId: "client-1",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: new Decimal("0.00100000")
    };

    const result = await gateway.placeOrder(request);

    expect(client.placeOrder).toHaveBeenCalledWith({
      clientOrderId: "client-1",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: "0.001"
    });
    expect(result).toMatchObject({
      clientOrderId: "client-1",
      exchangeOrderId: "123",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      status: "FILLED",
      eventTimeMs: 2_000
    });
    expect(result.executedQuantity.toString()).toBe("0.001");
    expect(result.cumulativeQuoteQuantity.toString()).toBe("85");
    expect(result.fills).toEqual([
      {
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: new Decimal("0.001"),
        price: new Decimal("85000"),
        fee: new Decimal("0.085"),
        feeAsset: "USDT",
        tsMs: 2_000
      }
    ]);
    await expect(gateway.getBalances()).resolves.toBe(balances);
  });

  it("places a limit order with price and default GTC time in force", async () => {
    const client = createClient({
      ...filledMarketOrder,
      price: "85000.12000000",
      executedQty: "0.00000000",
      cummulativeQuoteQty: "0.00000000",
      status: "NEW",
      type: "LIMIT"
    });
    const gateway = createBinanceExchangeGateway({ client, getBalances: async () => [] });

    await gateway.placeOrder({
      clientOrderId: "client-2",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "LIMIT",
      quantity: new Decimal("0.00200000"),
      price: new Decimal("85000.12000000")
    });

    expect(client.placeOrder).toHaveBeenCalledWith({
      clientOrderId: "client-2",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "LIMIT",
      quantity: "0.002",
      price: "85000.12",
      timeInForce: "GTC"
    });
  });

  it("rejects limit orders without a price before calling Binance", async () => {
    const client = createClient();
    const gateway = createBinanceExchangeGateway({ client, getBalances: async () => [] });

    await expect(
      gateway.placeOrder({
        clientOrderId: "client-3",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        quantity: new Decimal("0.001")
      })
    ).rejects.toThrow("Limit order price is required");
    expect(client.placeOrder).not.toHaveBeenCalled();
  });

  it("keeps the original client order id when mapping cancellation responses", async () => {
    const client = createClient({
      ...filledMarketOrder,
      status: "CANCELED",
      origClientOrderId: "client-1",
      clientOrderId: "generated-cancel-id"
    });
    const gateway = createBinanceExchangeGateway({ client, getBalances: async () => [] });

    const result = await gateway.cancelOrder({
      symbol: "BTCUSDT",
      clientOrderId: "client-1"
    });

    expect(client.cancelOrder).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      clientOrderId: "client-1"
    });
    expect(result.clientOrderId).toBe("client-1");
    expect(result.status).toBe("CANCELED");
  });

  it("maps queried and open orders into gateway snapshots", async () => {
    const client = createClient({
      ...filledMarketOrder,
      status: "NEW",
      type: "LIMIT",
      price: "85000.12000000",
      executedQty: "0.00000000",
      cummulativeQuoteQty: "0.00000000",
      updateTime: 3_000
    });
    const gateway = createBinanceExchangeGateway({ client, getBalances: async () => [] });

    const order = await gateway.getOrder({
      symbol: "BTCUSDT",
      clientOrderId: "client-1"
    });
    const openOrders = await gateway.getOpenOrders({ symbol: "BTCUSDT" });

    expect(client.queryOrder).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      clientOrderId: "client-1"
    });
    expect(client.openOrders).toHaveBeenCalledWith({ symbol: "BTCUSDT" });
    expect(order.price?.toString()).toBe("85000.12");
    expect(openOrders[0]?.status).toBe("NEW");
    expect(openOrders[0]?.eventTimeMs).toBe(2_000);
  });

  it("requires an injected balance reader until account endpoints exist", async () => {
    const gateway = createBinanceExchangeGateway({ client: createClient() });

    await expect(gateway.getBalances()).rejects.toThrow("Balance reader is not configured");
  });
});
