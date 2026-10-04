import type { OrderIntent } from "@meridian/core";

export interface PendingOrder {
  readonly intent: OrderIntent;
  readonly submittedAtMs: number;
}

export function createPendingOrders(symbol: string) {
  let pending: PendingOrder[] = [];

  return {
    enqueue(intent: OrderIntent, submittedAtMs: number): void {
      if (intent.symbol !== symbol || intent.type !== "MARKET") {
        throw new Error("Unsupported simulated order");
      }
      if (!intent.quantity.isFinite() || intent.quantity.lte(0)) {
        throw new Error("Quantity must be finite and positive");
      }
      if (!Number.isSafeInteger(submittedAtMs) || submittedAtMs < 0) {
        throw new Error("Invalid submission timestamp");
      }
      if (pending.length >= 1000) {
        throw new Error("Pending order queue is full");
      }

      pending.push({
        intent: { ...intent },
        submittedAtMs
      });
    },

    takeBefore(openTimeMs: number): readonly PendingOrder[] {
      if (!Number.isSafeInteger(openTimeMs) || openTimeMs < 0) {
        throw new Error("Invalid candle open timestamp");
      }

      const eligible = pending.filter((order) => order.submittedAtMs < openTimeMs);
      pending = pending.filter((order) => order.submittedAtMs >= openTimeMs);

      return eligible;
    }
  };
}
