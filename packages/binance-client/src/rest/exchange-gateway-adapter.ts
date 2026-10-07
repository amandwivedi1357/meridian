import {
  Decimal,
  type BalanceSnapshot,
  type ExchangeGateway,
  type GatewayOrderRequest,
  type GatewayOrderResult,
  type GatewayOrderSnapshot,
  type GatewayOrderStatus,
  type GatewayOrderType
} from "@meridian/core";

import type {
  BinanceOrderResponse,
  OpenOrdersParams,
  OrderLookupParams,
  PlaceOrderParams
} from "./order-schemas.js";

export interface BinanceExchangeGatewayClient {
  readonly placeOrder: (input: PlaceOrderParams) => Promise<BinanceOrderResponse>;
  readonly cancelOrder: (input: OrderLookupParams) => Promise<BinanceOrderResponse>;
  readonly queryOrder: (input: OrderLookupParams) => Promise<BinanceOrderResponse>;
  readonly openOrders: (input?: OpenOrdersParams) => Promise<readonly BinanceOrderResponse[]>;
}

export interface BinanceExchangeGatewayOptions {
  readonly client: BinanceExchangeGatewayClient;
  readonly getBalances?: () => Promise<readonly BalanceSnapshot[]>;
  readonly nowMs?: () => number;
}

export function createBinanceExchangeGateway(
  options: BinanceExchangeGatewayOptions
): ExchangeGateway {
  const nowMs = options.nowMs ?? Date.now;

  return {
    async placeOrder(request) {
      const order = await options.client.placeOrder(toPlaceOrderParams(request));
      return toGatewayOrderResult(order, nowMs, request.clientOrderId);
    },

    async cancelOrder(request) {
      const order = await options.client.cancelOrder(request);
      return toGatewayOrderResult(order, nowMs, request.clientOrderId);
    },

    async getOrder(request) {
      const order = await options.client.queryOrder(request);
      return toGatewayOrderSnapshot(order, nowMs, request.clientOrderId);
    },

    async getOpenOrders(request) {
      const orders = await options.client.openOrders(request);
      return orders.map((order) => toGatewayOrderSnapshot(order, nowMs));
    },

    async getBalances() {
      if (options.getBalances === undefined) {
        throw new Error("Balance reader is not configured");
      }

      return options.getBalances();
    }
  };
}

function toPlaceOrderParams(request: GatewayOrderRequest): PlaceOrderParams {
  if (request.type === "MARKET") {
    return {
      clientOrderId: request.clientOrderId,
      symbol: request.symbol,
      side: request.side,
      type: "MARKET",
      quantity: request.quantity.toFixed()
    };
  }

  if (request.price === undefined) {
    throw new Error("Limit order price is required");
  }

  return {
    clientOrderId: request.clientOrderId,
    symbol: request.symbol,
    side: request.side,
    type: "LIMIT",
    quantity: request.quantity.toFixed(),
    price: request.price.toFixed(),
    timeInForce: request.timeInForce ?? "GTC"
  };
}

function toGatewayOrderResult(
  order: BinanceOrderResponse,
  nowMs: () => number,
  requestedClientOrderId?: string
): GatewayOrderResult {
  const eventTimeMs = getOrderEventTimeMs(order, nowMs);

  return {
    clientOrderId: order.origClientOrderId ?? requestedClientOrderId ?? order.clientOrderId,
    exchangeOrderId: String(order.orderId),
    symbol: order.symbol,
    side: order.side,
    type: toGatewayOrderType(order.type),
    status: toGatewayOrderStatus(order.status),
    executedQuantity: new Decimal(order.executedQty),
    cumulativeQuoteQuantity: new Decimal(order.cummulativeQuoteQty),
    eventTimeMs,
    fills: (order.fills ?? []).map((fill) => ({
      symbol: order.symbol,
      side: order.side,
      quantity: new Decimal(fill.qty),
      price: new Decimal(fill.price),
      fee: new Decimal(fill.commission),
      feeAsset: fill.commissionAsset,
      tsMs: eventTimeMs
    }))
  };
}

function toGatewayOrderSnapshot(
  order: BinanceOrderResponse,
  nowMs: () => number,
  requestedClientOrderId?: string
): GatewayOrderSnapshot {
  return {
    clientOrderId: order.origClientOrderId ?? requestedClientOrderId ?? order.clientOrderId,
    exchangeOrderId: String(order.orderId),
    symbol: order.symbol,
    side: order.side,
    type: toGatewayOrderType(order.type),
    status: toGatewayOrderStatus(order.status),
    executedQuantity: new Decimal(order.executedQty),
    cumulativeQuoteQuantity: new Decimal(order.cummulativeQuoteQty),
    price: new Decimal(order.price),
    eventTimeMs: getOrderEventTimeMs(order, nowMs)
  };
}

function getOrderEventTimeMs(order: BinanceOrderResponse, nowMs: () => number): number {
  return order.transactTime ?? order.updateTime ?? order.time ?? nowMs();
}

function toGatewayOrderType(type: BinanceOrderResponse["type"]): GatewayOrderType {
  if (type === "MARKET" || type === "LIMIT") return type;
  throw new Error(`Unsupported Binance order type for gateway adapter: ${type}`);
}

function toGatewayOrderStatus(status: BinanceOrderResponse["status"]): GatewayOrderStatus {
  switch (status) {
    case "NEW":
    case "PARTIALLY_FILLED":
    case "FILLED":
    case "CANCELED":
    case "REJECTED":
      return status;
    case "EXPIRED":
    case "EXPIRED_IN_MATCH":
      return "EXPIRED";
    case "PENDING_NEW":
    case "PENDING_CANCEL":
      return "UNKNOWN";
  }
}
