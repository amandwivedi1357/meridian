import {
  Decimal,
  type BalanceSnapshot,
  type Candle,
  type Fill,
  type GatewayOrderRequest,
  type GatewayOrderResult,
  type GatewayOrderSnapshot,
  type OrderIntent,
  type SimulatedExchangeGateway,
  type SymbolCode,
} from "@meridian/core";

import type { SimBroker } from "./sim-broker.js";

export interface SimExchangeGatewayOptions {
  readonly broker: SimBroker;
  readonly symbol: SymbolCode;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly balanceAssets?: readonly string[];
  readonly nowMs?: () => number;
}

export function createSimExchangeGateway(
  options: SimExchangeGatewayOptions
): SimulatedExchangeGateway {
  const nowMs = options.nowMs ?? Date.now;
  const openOrders = new Map<string, GatewayOrderSnapshot>();

  return {
    async placeOrder(request) {
      const submittedAtMs = nowMs();
      const intent = toOrderIntent(request);

      options.broker.submit(intent, submittedAtMs);

      const result: GatewayOrderResult = {
        clientOrderId: request.clientOrderId,
        exchangeOrderId: `sim:${request.clientOrderId}`,
        symbol: request.symbol,
        side: request.side,
        type: request.type,
        status: "NEW",
        executedQuantity: new Decimal("0"),
        cumulativeQuoteQuantity: new Decimal("0"),
        fills: [],
        eventTimeMs: submittedAtMs,
      };

      openOrders.set(request.clientOrderId, {
  ...result,
  ...(request.price === undefined ? {} : { price: request.price }),
});

      return result;
    },

    async cancelOrder() {
      throw new Error("Simulated exchange gateway does not support cancellation");
    },

    async getOrder(request) {
      const order = openOrders.get(request.clientOrderId);
      if (order === undefined || order.symbol !== request.symbol) {
        throw new Error("Simulated order not found");
      }

      return order;
    },

    async getOpenOrders(request) {
      const orders = [...openOrders.values()];
      if (request?.symbol === undefined) return orders;
      return orders.filter((order) => order.symbol === request.symbol);
    },

    async getBalances() {
      const assets = uniqueAssets([
        options.quoteAsset,
        options.baseAsset,
        ...(options.balanceAssets ?? []),
      ]);

      return assets.map((asset): BalanceSnapshot => ({
        asset,
        free: options.broker.balance(asset),
        locked: new Decimal("0"),
      }));
    },

    processCandle(candle) {
      const fills = options.broker.processCandle(candle);

      for (const fill of fills) {
        removeFirstMatchingOpenOrder(openOrders, fill);
      }

      return fills;
    },

    position(symbol) {
      const position = options.broker.position();

      if (symbol !== undefined && position.symbol !== symbol) {
        return {
          symbol,
          quantity: new Decimal("0"),
          avgEntry: new Decimal("0"),
          realizedPnl: new Decimal("0"),
        };
      }

      return position;
    },
  };
}

function toOrderIntent(request: GatewayOrderRequest): OrderIntent {
  if (request.type === "MARKET") {
    return {
      symbol: request.symbol,
      side: request.side,
      type: "MARKET",
      quantity: request.quantity,
      reason: request.clientOrderId,
    };
  }

  if (request.price === undefined) {
    throw new Error("Limit order price is required");
  }

  return {
    symbol: request.symbol,
    side: request.side,
    type: "LIMIT",
    quantity: request.quantity,
    limitPrice: request.price,
    reason: request.clientOrderId,
  };
}

function removeFirstMatchingOpenOrder(
  openOrders: Map<string, GatewayOrderSnapshot>,
  fill: Fill
): void {
  for (const [clientOrderId, order] of openOrders) {
    if (
      order.symbol === fill.symbol &&
      order.side === fill.side &&
      order.executedQuantity.isZero()
    ) {
      openOrders.delete(clientOrderId);
      return;
    }
  }
}

function uniqueAssets(assets: readonly string[]): readonly string[] {
  return [...new Set(assets)];
}