export const ORDER_STATES = [
  "PENDING_NEW",
  "NEW",
  "PARTIALLY_FILLED",
  "FILLED",
  "PENDING_CANCEL",
  "CANCELED",
  "REJECTED",
  "EXPIRED",
  "UNKNOWN"
] as const;

export type OrderState = (typeof ORDER_STATES)[number];

export type OrderLifecycleEvent =
  | "acknowledged"
  | "partiallyFilled"
  | "filled"
  | "rejected"
  | "expired"
  | "sendOutcomeUnknown"
  | "cancelRequested"
  | "canceled"
  | "cancelOutcomeUnknown";

const transitions: Record<OrderState, Partial<Record<OrderLifecycleEvent, OrderState>>> = {
  PENDING_NEW: {
    acknowledged: "NEW",
    partiallyFilled: "PARTIALLY_FILLED",
    filled: "FILLED",
    rejected: "REJECTED",
    expired: "EXPIRED",
    sendOutcomeUnknown: "UNKNOWN"
  },
  UNKNOWN: {
    acknowledged: "NEW",
    partiallyFilled: "PARTIALLY_FILLED",
    filled: "FILLED",
    canceled: "CANCELED",
    rejected: "REJECTED",
    expired: "EXPIRED"
  },
  NEW: {
    partiallyFilled: "PARTIALLY_FILLED",
    filled: "FILLED",
    cancelRequested: "PENDING_CANCEL",
    expired: "EXPIRED"
  },
  PARTIALLY_FILLED: {
    partiallyFilled: "PARTIALLY_FILLED",
    filled: "FILLED",
    cancelRequested: "PENDING_CANCEL",
    expired: "EXPIRED"
  },
  PENDING_CANCEL: {
    canceled: "CANCELED",
    cancelOutcomeUnknown: "UNKNOWN",
    partiallyFilled: "PENDING_CANCEL",
    filled: "FILLED",
    expired: "EXPIRED"
  },
  FILLED: {},
  CANCELED: {},
  REJECTED: {},
  EXPIRED: {}
};

export function canTransitionOrderState(from: OrderState, event: OrderLifecycleEvent): boolean {
  return transitions[from][event] !== undefined;
}

export function transitionOrderState(from: OrderState, event: OrderLifecycleEvent): OrderState {
  const next = transitions[from][event];

  if (next === undefined) {
    throw new Error(`Illegal order state transition: ${from} + ${event}`);
  }

  return next;
}
