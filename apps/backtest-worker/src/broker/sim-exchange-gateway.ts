import {
  Decimal,
  type BalanceSnapshot,
  type GatewayOrderRequest,
  type GatewayOrderResult,
  type GatewayOrderSnapshot,
  type OrderIntent,
  type SimulatedExchangeGateway,
  type SymbolCode
} from "@meridian/core";

import type { SimBroker, SimulatedFill } from "./sim-broker.js";

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
  const orders = new Map<string, GatewayOrderSnapshot>();

  return {
    async placeOrder(request) {
      if (orders.has(request.clientOrderId)) throw new Error("Duplicate simulated client order id");
      const submittedAtMs = nowMs();
      const intent = toOrderIntent(request);

      options.broker.submit(intent, submittedAtMs, request.clientOrderId);

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
        eventTimeMs: submittedAtMs
      };

      orders.set(request.clientOrderId, {
        ...result,
        ...(request.price === undefined ? {} : { price: request.price })
      });

      return result;
    },

    async cancelOrder() {
      throw new Error("Simulated exchange gateway does not support cancellation");
    },

    async getOrder(request) {
      const order = orders.get(request.clientOrderId);
      if (order === undefined || order.symbol !== request.symbol) {
        throw new Error("Simulated order not found");
      }

      return order;
    },

    async getOpenOrders(request) {
      const openOrders = [...orders.values()].filter(
        (order) => order.status === "NEW" || order.status === "PARTIALLY_FILLED"
      );
      if (request?.symbol === undefined) return openOrders;
      return openOrders.filter((order) => order.symbol === request.symbol);
    },

    async getBalances() {
      const assets = uniqueAssets([
        options.quoteAsset,
        options.baseAsset,
        ...(options.balanceAssets ?? [])
      ]);

      return assets.map((asset): BalanceSnapshot => ({
        asset,
        free: options.broker.balance(asset),
        locked: new Decimal("0")
      }));
    },

    processCandle(candle) {
      const fills = options.broker.processCandle(candle);

      for (const fill of fills) {
        applySimulatedFill(orders, fill);
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
          realizedPnl: new Decimal("0")
        };
      }

      return position;
    }
  };
}

function toOrderIntent(request: GatewayOrderRequest): OrderIntent {
  if (request.type === "MARKET") {
    return {
      symbol: request.symbol,
      side: request.side,
      type: "MARKET",
      quantity: request.quantity,
      reason: request.clientOrderId
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
    reason: request.clientOrderId
  };
}

function applySimulatedFill(orders: Map<string, GatewayOrderSnapshot>, fill: SimulatedFill): void {
  const order = fill.clientOrderId === undefined ? undefined : orders.get(fill.clientOrderId);
  if (order === undefined || order.symbol !== fill.symbol || order.side !== fill.side) {
    throw new Error("Simulated fill order identity mismatch");
  }
  orders.set(order.clientOrderId, {
    ...order,
    status: "FILLED",
    executedQuantity: order.executedQuantity.plus(fill.quantity),
    cumulativeQuoteQuantity: order.cumulativeQuoteQuantity.plus(fill.price.times(fill.quantity)),
    eventTimeMs: fill.tsMs
  });
}

function uniqueAssets(assets: readonly string[]): readonly string[] {
  return [...new Set(assets)];
}
