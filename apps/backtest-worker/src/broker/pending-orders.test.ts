import { describe, expect, it } from "vitest";
import { Decimal, type OrderIntent } from "@meridian/core";
import { createPendingOrders } from "./pending-orders.js";

function order(reason = "signal"): OrderIntent {
  return { symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: new Decimal("0.01"), reason };
}

describe("pending orders", () => {
  it("never releases an order at an open at or before submission", () => {
    const queue = createPendingOrders("BTCUSDT");
    queue.enqueue(order(), 100);
    expect(queue.takeBefore(99)).toEqual([]);
    expect(queue.takeBefore(100)).toEqual([]);
    expect(queue.takeBefore(101)).toEqual([{ intent: order(), submittedAtMs: 100 }]);
  });

  it("releases orders once and retains orders submitted later", () => {
    const queue = createPendingOrders("BTCUSDT");
    queue.enqueue(order("early"), 10);
    queue.enqueue(order("later"), 30);
    expect(queue.takeBefore(20).map((item) => item.intent.reason)).toEqual(["early"]);
    expect(queue.takeBefore(20)).toEqual([]);
    expect(queue.takeBefore(31).map((item) => item.intent.reason)).toEqual(["later"]);
    expect(queue.takeBefore(100)).toEqual([]);
  });

  it("preserves submission order within an eligible batch", () => {
    const queue = createPendingOrders("BTCUSDT");
    queue.enqueue(order("first"), 10);
    queue.enqueue(order("second"), 10);
    expect(queue.takeBefore(11).map((item) => item.intent.reason)).toEqual(["first", "second"]);
  });

  it("snapshots an intent rather than keeping a mutable caller object", () => {
    const queue = createPendingOrders("BTCUSDT");
    const intent = { ...order() };
    queue.enqueue(intent, 0);
    intent.reason = "changed";
    intent.quantity = new Decimal(100);
    const released = queue.takeBefore(1)[0]?.intent;
    expect(released?.reason).toBe("signal");
    expect(released?.quantity.toString()).toBe("0.01");
  });

  it("rejects queue overflow and permits enqueueing after draining", () => {
    const queue = createPendingOrders("BTCUSDT");
    for (let index = 0; index < 1000; index++) queue.enqueue(order(String(index)), 0);
    expect(() => queue.enqueue(order("overflow"), 0)).toThrow("Pending order queue is full");
    expect(queue.takeBefore(1)).toHaveLength(1000);
    queue.enqueue(order("after drain"), 1);
    expect(queue.takeBefore(2).map((item) => item.intent.reason)).toEqual(["after drain"]);
  });

  it.each([{ symbol: "ETHUSDT" }, { type: "LIMIT" as const }])(
    "rejects unsupported orders %j without queueing them",
    (override) => {
      const queue = createPendingOrders("BTCUSDT");
      expect(() => queue.enqueue({ ...order(), ...override }, 0)).toThrow(
        "Unsupported simulated order"
      );
      expect(queue.takeBefore(1)).toEqual([]);
    }
  );

  it.each(["0", "-0.01", "NaN", "Infinity"])("rejects invalid quantity %s", (quantity) => {
    const queue = createPendingOrders("BTCUSDT");
    expect(() => queue.enqueue({ ...order(), quantity: new Decimal(quantity) }, 0)).toThrow(
      "Quantity must be finite and positive"
    );
    expect(queue.takeBefore(1)).toEqual([]);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid submission timestamp %s",
    (timestamp) => {
      const queue = createPendingOrders("BTCUSDT");
      expect(() => queue.enqueue(order(), timestamp)).toThrow("Invalid submission timestamp");
      expect(queue.takeBefore(1)).toEqual([]);
    }
  );

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid candle timestamp %s without removing orders",
    (timestamp) => {
      const queue = createPendingOrders("BTCUSDT");
      queue.enqueue(order(), 0);
      expect(() => queue.takeBefore(timestamp)).toThrow("Invalid candle open timestamp");
      expect(queue.takeBefore(1)).toHaveLength(1);
    }
  );
});
