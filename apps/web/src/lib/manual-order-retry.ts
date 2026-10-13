import type { ManualOrderRequest } from "./api-client.js";
const key = "meridian.manual-order.pending.v1";
export function readManualRetry(storage: Pick<Storage, "getItem">): ManualOrderRequest | undefined {
  try {
    const value = JSON.parse(storage.getItem(key) ?? "null");
    if (
      value &&
      typeof value.requestId === "string" &&
      /^[a-f0-9-]{36}$/i.test(value.requestId) &&
      /^[A-Z0-9]{2,30}$/.test(value.symbol) &&
      ["BUY", "SELL"].includes(value.side) &&
      ["MARKET", "LIMIT"].includes(value.type) &&
      typeof value.quantity === "string" &&
      /^\d+(\.\d+)?$/.test(value.quantity) &&
      typeof value.reason === "string" &&
      value.confirm === "QUEUE_MANUAL_ORDER"
    )
      return value;
  } catch {
    /* Invalid browser storage never creates a request. */
  }
  return undefined;
}
export function saveManualRetry(storage: Pick<Storage, "setItem">, request: ManualOrderRequest) {
  storage.setItem(key, JSON.stringify(request));
}
export function clearManualRetry(storage: Pick<Storage, "removeItem">) {
  storage.removeItem(key);
}
