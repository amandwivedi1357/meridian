import { it, expect } from "vitest";
import { readManualRetry, saveManualRetry, clearManualRetry } from "./manual-order-retry.js";
import type { ManualOrderRequest } from "./api-client.js";
it("preserves pending request identity and inputs across remount/reload", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    }
  };
  const request: ManualOrderRequest = {
    requestId: "00000000-0000-4000-8000-000000000001",
    symbol: "BTCUSDT",
    quantity: "0.0002",
    type: "MARKET",
    side: "BUY",
    reason: "test",
    confirm: "QUEUE_MANUAL_ORDER"
  };
  saveManualRetry(storage, request);
  expect(readManualRetry(storage)).toEqual(request);
  clearManualRetry(storage);
  expect(readManualRetry(storage)).toBeUndefined();
});
