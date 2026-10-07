import { describe, expect, it } from "vitest";

import {
  ORDER_STATES,
  canTransitionOrderState,
  transitionOrderState,
  type OrderLifecycleEvent,
  type OrderState
} from "./order-lifecycle.js";

const terminalStates: readonly OrderState[] = ["FILLED", "CANCELED", "REJECTED", "EXPIRED"];

describe("order lifecycle state machine", () => {
  it.each([
    ["PENDING_NEW", "acknowledged", "NEW"],
    ["PENDING_NEW", "partiallyFilled", "PARTIALLY_FILLED"],
    ["PENDING_NEW", "filled", "FILLED"],
    ["PENDING_NEW", "rejected", "REJECTED"],
    ["PENDING_NEW", "expired", "EXPIRED"],
    ["PENDING_NEW", "sendOutcomeUnknown", "UNKNOWN"],
    ["UNKNOWN", "acknowledged", "NEW"],
    ["UNKNOWN", "partiallyFilled", "PARTIALLY_FILLED"],
    ["UNKNOWN", "filled", "FILLED"],
    ["UNKNOWN", "canceled", "CANCELED"],
    ["UNKNOWN", "rejected", "REJECTED"],
    ["UNKNOWN", "expired", "EXPIRED"],
    ["NEW", "partiallyFilled", "PARTIALLY_FILLED"],
    ["NEW", "filled", "FILLED"],
    ["NEW", "cancelRequested", "PENDING_CANCEL"],
    ["NEW", "expired", "EXPIRED"],
    ["PARTIALLY_FILLED", "partiallyFilled", "PARTIALLY_FILLED"],
    ["PARTIALLY_FILLED", "filled", "FILLED"],
    ["PARTIALLY_FILLED", "cancelRequested", "PENDING_CANCEL"],
    ["PARTIALLY_FILLED", "expired", "EXPIRED"],
    ["PENDING_CANCEL", "canceled", "CANCELED"],
    ["PENDING_CANCEL", "cancelOutcomeUnknown", "UNKNOWN"],
    ["PENDING_CANCEL", "partiallyFilled", "PARTIALLY_FILLED"],
    ["PENDING_CANCEL", "filled", "FILLED"],
    ["PENDING_CANCEL", "expired", "EXPIRED"]
  ] as const)("transitions %s + %s -> %s", (from, event, to) => {
    expect(transitionOrderState(from, event)).toBe(to);
    expect(canTransitionOrderState(from, event)).toBe(true);
  });

  it("rejects illegal transitions without changing terminal states", () => {
    for (const state of terminalStates) {
      for (const event of lifecycleEvents()) {
        expect(canTransitionOrderState(state, event)).toBe(false);
        expect(() => transitionOrderState(state, event)).toThrow(
          `Illegal order state transition: ${state} + ${event}`
        );
      }
    }
  });

  it.each([
    ["PENDING_NEW", "cancelRequested"],
    ["NEW", "acknowledged"],
    ["NEW", "sendOutcomeUnknown"],
    ["PARTIALLY_FILLED", "acknowledged"],
    ["PENDING_CANCEL", "acknowledged"],
    ["PENDING_CANCEL", "cancelRequested"]
  ] as const)("rejects invalid nonterminal transition %s + %s", (state, event) => {
    expect(canTransitionOrderState(state, event)).toBe(false);
    expect(() => transitionOrderState(state, event)).toThrow(
      `Illegal order state transition: ${state} + ${event}`
    );
  });

  it("keeps the exported state list exhaustive", () => {
    expect(ORDER_STATES).toEqual([
      "PENDING_NEW",
      "NEW",
      "PARTIALLY_FILLED",
      "FILLED",
      "PENDING_CANCEL",
      "CANCELED",
      "REJECTED",
      "EXPIRED",
      "UNKNOWN"
    ]);
  });
});

function lifecycleEvents(): readonly OrderLifecycleEvent[] {
  return [
    "acknowledged",
    "partiallyFilled",
    "filled",
    "rejected",
    "expired",
    "sendOutcomeUnknown",
    "cancelRequested",
    "canceled",
    "cancelOutcomeUnknown"
  ];
}
