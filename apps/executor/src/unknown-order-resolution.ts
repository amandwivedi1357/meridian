import type { GatewayOrderSnapshot, OrderState } from "@meridian/core";

export interface UnknownOrderResolutionLocalOrder {
  readonly clientOrderId: string;
  readonly symbol: string;
  readonly state: OrderState;
  readonly exchangeOrderId: string | null;
}

export interface UnknownOrderResolutionStore {
  readonly getOrderForUnknownResolution: (
    clientOrderId: string
  ) => Promise<UnknownOrderResolutionLocalOrder | null>;
  readonly resolveUnknownOrderAsNotSent: (record: {
    readonly clientOrderId: string;
    readonly actor: string;
    readonly reason: string;
    readonly resolvedAtMs: number;
  }) => Promise<void>;
}

export interface UnknownOrderResolutionExchange {
  readonly getOrder: (request: {
    readonly symbol: string;
    readonly clientOrderId: string;
  }) => Promise<Pick<GatewayOrderSnapshot, "clientOrderId" | "symbol"> | null>;
}

export type UnknownOrderResolutionResult =
  | {
      readonly outcome: "resolved-not-sent";
      readonly clientOrderId: string;
      readonly symbol: string;
    }
  | {
      readonly outcome: "exchange-order-exists";
      readonly clientOrderId: string;
      readonly symbol: string;
    };

export async function runUnknownOrderResolution(options: {
  readonly clientOrderId: string;
  readonly actor: string;
  readonly reason: string;
  readonly nowMs?: () => number;
  readonly store: UnknownOrderResolutionStore;
  readonly exchange: UnknownOrderResolutionExchange;
}): Promise<UnknownOrderResolutionResult> {
  const clientOrderId = options.clientOrderId.trim();
  const actor = options.actor.trim();
  const reason = options.reason.trim();

  if (clientOrderId === "") throw new Error("clientOrderId is required");
  if (actor === "") throw new Error("actor is required");
  if (reason === "") throw new Error("reason is required");

  const local = await options.store.getOrderForUnknownResolution(clientOrderId);
  if (
    local === null ||
    local.state !== "UNKNOWN" ||
    local.clientOrderId !== clientOrderId ||
    local.exchangeOrderId !== null
  ) {
    throw new Error("Order is not an unresolved UNKNOWN submission");
  }

  const exchangeOrder = await options.exchange.getOrder({
    symbol: local.symbol,
    clientOrderId
  });
  if (exchangeOrder !== null) {
    if (exchangeOrder.clientOrderId !== clientOrderId || exchangeOrder.symbol !== local.symbol) {
      throw new Error("Exchange order identity mismatch");
    }
    return {
      outcome: "exchange-order-exists",
      clientOrderId,
      symbol: local.symbol
    };
  }

  await options.store.resolveUnknownOrderAsNotSent({
    clientOrderId,
    actor,
    reason,
    resolvedAtMs: (options.nowMs ?? Date.now)()
  });

  return {
    outcome: "resolved-not-sent",
    clientOrderId,
    symbol: local.symbol
  };
}
