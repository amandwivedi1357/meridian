import { Decimal, type GatewayOrderSnapshot, type ReconciliationExchange } from "@meridian/core";

import { BinanceSignedRequestError } from "./authenticated-http.js";
import type { BinanceOrderResponse, OrderLookupParams } from "./order-schemas.js";

export interface BinanceReconciliationExchangeClient {
  readonly queryOrder: (input: OrderLookupParams) => Promise<BinanceOrderResponse>;
}

export interface BinanceReconciliationExchangeOptions {
  readonly client: BinanceReconciliationExchangeClient;
  readonly nowMs?: () => number;
}

export function createBinanceReconciliationExchange(
  options: BinanceReconciliationExchangeOptions
): ReconciliationExchange {
  const nowMs = options.nowMs ?? Date.now;

  return {
    async getOrder(request) {
      try {
        const order = await options.client.queryOrder(request);
        return toGatewayOrderSnapshot(order, nowMs, request.clientOrderId);
      } catch (error) {
        if (isOrderNotFound(error)) {
          return null;
        }

        throw error;
      }
    }
  };
}

function isOrderNotFound(error: unknown): boolean {
  return (
    error instanceof BinanceSignedRequestError &&
    error.outcome === "rejected" &&
    (error.code === -2011 || error.code === -2013)
  );
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
    eventTimeMs: order.transactTime ?? order.updateTime ?? order.time ?? nowMs()
  };
}

function toGatewayOrderType(type: BinanceOrderResponse["type"]): GatewayOrderSnapshot["type"] {
  if (type === "MARKET" || type === "LIMIT") return type;
  throw new Error(`Unsupported Binance order type for reconciliation: ${type}`);
}

function toGatewayOrderStatus(
  status: BinanceOrderResponse["status"]
): GatewayOrderSnapshot["status"] {
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