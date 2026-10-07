import { describe, expect, it } from "vitest";

import {
  Decimal,
  type Candle,
  type ExchangeGateway,
  type GatewayOrderRequest,
  type MarketDataSource,
} from "./index.js";

describe("exchange contracts", () => {
  it("allows an exchange gateway implementation to satisfy the shared contract", async () => {
    const request: GatewayOrderRequest = {
      clientOrderId: "client-1",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: new Decimal("0.001"),
      price: new Decimal("42000.50"),
      timeInForce: "GTC",
    };

    const gateway: ExchangeGateway = {
      async placeOrder(order) {
        return {
          clientOrderId: order.clientOrderId,
          exchangeOrderId: "1001",
          symbol: order.symbol,
          side: order.side,
          type: order.type,
          status: "NEW",
          executedQuantity: new Decimal("0"),
          cumulativeQuoteQuantity: new Decimal("0"),
          fills: [],
          eventTimeMs: 1_704_067_200_000,
        };
      },

      async cancelOrder(order) {
        return {
          clientOrderId: order.clientOrderId,
          exchangeOrderId: "1001",
          symbol: order.symbol,
          side: "BUY",
          type: "LIMIT",
          status: "CANCELED",
          executedQuantity: new Decimal("0"),
          cumulativeQuoteQuantity: new Decimal("0"),
          fills: [],
          eventTimeMs: 1_704_067_201_000,
        };
      },

      async getOrder(order) {
        return {
          clientOrderId: order.clientOrderId,
          exchangeOrderId: "1001",
          symbol: order.symbol,
          side: "BUY",
          type: "LIMIT",
          status: "NEW",
          executedQuantity: new Decimal("0"),
          cumulativeQuoteQuantity: new Decimal("0"),
          price: new Decimal("42000.50"),
          eventTimeMs: 1_704_067_200_000,
        };
      },

      async getOpenOrders() {
        return [];
      },

      async getBalances() {
        return [
          {
            asset: "USDT",
            free: new Decimal("1000"),
            locked: new Decimal("0"),
          },
        ];
      },
    };

    const accepted = await gateway.placeOrder(request);
    const balances = await gateway.getBalances();

    expect(accepted.clientOrderId).toBe("client-1");
    expect(accepted.status).toBe("NEW");
    expect(accepted.executedQuantity.toString()).toBe("0");
    expect(balances[0]?.asset).toBe("USDT");
  });

  it("allows market data sources to stream candles through a shared contract", async () => {
    const candle: Candle = {
      symbol: "BTCUSDT",
      interval: "15m",
      openTimeMs: 1_704_067_200_000,
      closeTimeMs: 1_704_068_099_999,
      open: new Decimal("42000"),
      high: new Decimal("42100"),
      low: new Decimal("41950"),
      close: new Decimal("42050"),
      volume: new Decimal("12.5"),
      closed: true,
    };

    const source: MarketDataSource = {
      async *getCandles() {
        yield candle;
      },
    };

    const candles: Candle[] = [];

    for await (const item of source.getCandles({
      symbol: "BTCUSDT",
      interval: "15m",
      limit: 1,
    })) {
      candles.push(item);
    }

    expect(candles).toHaveLength(1);
    expect(candles[0]?.close.toString()).toBe("42050");
  });
});
