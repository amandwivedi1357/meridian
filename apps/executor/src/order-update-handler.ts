import type { OrderExecutionUpdateRecord } from "@meridian/db";
import type { UserDataOrderUpdate } from "@meridian/binance-client";

export interface OrderUpdateStore {
  readonly recordOrderExecutionUpdate: (record: OrderExecutionUpdateRecord) => Promise<void>;
}

export interface OrderUpdateHandlerDeps {
  readonly store: OrderUpdateStore;
}

export async function handleUserDataOrderUpdate(
  update: UserDataOrderUpdate,
  deps: OrderUpdateHandlerDeps
): Promise<void> {
  const fill = toFillRecord(update);

  await deps.store.recordOrderExecutionUpdate({
    clientOrderId: update.originalClientOrderId ?? update.clientOrderId,
    exchangeOrderId: update.orderId,
    state: toStoredOrderState(update.status),
    executedQuantity: update.executedQuantity.toFixed(),
    cumulativeQuoteQuantity: update.cumulativeQuoteQuantity.toFixed(),
    exchangeEventTimeMs: update.eventTimeMs,
    executionId: update.executionId,
    ...(fill === undefined ? {} : { fill })
  });
}

function toStoredOrderState(status: UserDataOrderUpdate["status"]): OrderExecutionUpdateRecord["state"] {
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

function toFillRecord(
  update: UserDataOrderUpdate
): OrderExecutionUpdateRecord["fill"] | undefined {
  if (update.executionType !== "TRADE") return undefined;
  if (update.tradeId === undefined) throw new Error("Trade fill tradeId is required");
  if (update.commission.gt(0) && update.commissionAsset === null) {
    throw new Error("Trade fill commission asset is required");
  }

  return {
    tradeId: update.tradeId,
    symbol: update.symbol,
    side: update.side,
    quantity: update.lastQuantity.toFixed(),
    price: update.lastPrice.toFixed(),
    fee: update.commission.toFixed(),
    feeAsset: update.commissionAsset ?? "UNKNOWN"
  };
}
