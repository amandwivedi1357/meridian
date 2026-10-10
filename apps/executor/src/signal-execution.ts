import {
  streams,
  type RedisStreamClient,
  type StreamFieldValue,
  type StreamMessage
} from "@meridian/bus";
import {
  createClientOrderId,
  isSignalExpired,
  parseSignalPayload,
  type ExchangeGateway,
  type GatewayOrderRequest,
  type OrderState,
  type Signal
} from "@meridian/core";
import type { PendingOrderRecord } from "@meridian/db";

export interface SignalOrderStore {
  readonly getSubmissionState?: (record: PendingOrderRecord) => Promise<OrderState | null>;
  readonly recordPendingOrder: (record: PendingOrderRecord) => Promise<void>;
  readonly claimOrderSubmission: (clientOrderId: string) => Promise<boolean>;
}

export type RiskDecision =
  | {
      readonly approved: true;
    }
  | {
      readonly approved: false;
      readonly reason: string;
    };

export interface SignalRiskGate {
  readonly evaluate: (signal: Signal) => Promise<RiskDecision>;
}

export interface SignalExecutionMetrics {
  readonly recordExpiredSignal: (signal: Signal) => void;
}

export interface SignalExecutionDeps {
  readonly store: SignalOrderStore;
  readonly exchange: Pick<ExchangeGateway, "placeOrder"> & {
    readonly getOrder?: (request: {
      symbol: string;
      clientOrderId: string;
    }) => Promise<{ clientOrderId: string; symbol: string } | null>;
  };
  readonly clientOrderIdPrefix: string;
  readonly nowMs: () => number;
  readonly riskGate?: SignalRiskGate;
  readonly metrics?: SignalExecutionMetrics;
  readonly beforeSubmit?: (signal: Signal) => Promise<void>;
}

export interface SignalMessageDeps extends SignalExecutionDeps {
  readonly bus: Pick<RedisStreamClient, "xAck">;
  readonly group: string;
  readonly recordRejection?: (details: {
    messageId: string;
    signalId?: string;
    reason: string;
  }) => Promise<void>;
}

export type SignalProcessingResult =
  | {
      readonly outcome: "submitted";
      readonly signalId: string;
      readonly clientOrderId: string;
    }
  | {
      readonly outcome: "expired";
      readonly signalId: string;
    }
  | {
      readonly outcome: "rejected";
      readonly signalId?: string;
      readonly reason: string;
    };

export async function processSignalMessage(
  message: StreamMessage,
  deps: SignalMessageDeps
): Promise<SignalProcessingResult> {
  async function finish(result: SignalProcessingResult) {
    if (result.outcome !== "submitted") {
      await deps.recordRejection?.({
        messageId: message.id,
        ...(result.signalId === undefined ? {} : { signalId: result.signalId }),
        reason: result.outcome === "expired" ? "signal-expired" : result.reason
      });
    }
    await ackSignalMessage(message, deps);
    return result;
  }
  if (readField(message.fields.kind) !== "signal") {
    return finish({ outcome: "rejected", reason: "unexpected-message-kind" });
  }

  const payload = message.fields.payload;
  if (payload === undefined) {
    return finish({ outcome: "rejected", reason: "missing-payload" });
  }

  let signal: Signal;
  try {
    signal = parseSignalPayload(payload);
  } catch {
    return finish({ outcome: "rejected", reason: "invalid-payload" });
  }

  const result = await executeSignal(signal, deps);
  return finish(result);
}

export async function executeSignal(
  signal: Signal,
  deps: SignalExecutionDeps
): Promise<SignalProcessingResult> {
  const validationFailure = validateExecutableSignal(signal);
  if (validationFailure !== undefined) {
    return {
      outcome: "rejected",
      signalId: signal.signalId,
      reason: validationFailure
    };
  }

  const attempt = 0;
  const clientOrderId = createClientOrderId({
    prefix: deps.clientOrderIdPrefix,
    strategyId: signal.strategyId,
    signalId: signal.signalId,
    attempt
  });
  const request = toGatewayOrderRequest(signal, clientOrderId);
  const record = toPendingOrderRecord(signal, request, attempt, deps.nowMs());
  // Recovery confirms previous side effects; it never grants permission for a new send.
  const state = await deps.store.getSubmissionState?.(record);
  if (state !== undefined && state !== null && state !== "PENDING_NEW") {
    return recoverSubmission(signal, request, deps);
  }

  if (isSignalExpired(signal, deps.nowMs())) {
    deps.metrics?.recordExpiredSignal(signal);
    return { outcome: "expired", signalId: signal.signalId };
  }
  const riskDecision = await evaluateRisk(signal, deps);
  if (!riskDecision.approved) {
    return { outcome: "rejected", signalId: signal.signalId, reason: riskDecision.reason };
  }
  if (isSignalExpired(signal, deps.nowMs())) {
    deps.metrics?.recordExpiredSignal(signal);
    return { outcome: "expired", signalId: signal.signalId };
  }
  await deps.store.recordPendingOrder(toPendingOrderRecord(signal, request, attempt, deps.nowMs()));
  if (isSignalExpired(signal, deps.nowMs())) {
    deps.metrics?.recordExpiredSignal(signal);
    return { outcome: "expired", signalId: signal.signalId };
  }

  if (!(await deps.store.claimOrderSubmission(clientOrderId))) {
    return recoverSubmission(signal, request, deps);
  }
  if (isSignalExpired(signal, deps.nowMs())) {
    deps.metrics?.recordExpiredSignal(signal);
    return { outcome: "expired", signalId: signal.signalId };
  }
  await deps.beforeSubmit?.(signal);
  if (isSignalExpired(signal, deps.nowMs())) {
    deps.metrics?.recordExpiredSignal(signal);
    return { outcome: "expired", signalId: signal.signalId };
  }
  await deps.exchange.placeOrder(request);

  return {
    outcome: "submitted",
    signalId: signal.signalId,
    clientOrderId
  };
}

async function recoverSubmission(
  signal: Signal,
  request: GatewayOrderRequest,
  deps: SignalExecutionDeps
): Promise<SignalProcessingResult> {
  if (deps.exchange.getOrder === undefined)
    throw new Error("Order recovery query is not configured");
  const existing = await deps.exchange.getOrder({
    symbol: request.symbol,
    clientOrderId: request.clientOrderId
  });
  if (
    existing === null ||
    existing.clientOrderId !== request.clientOrderId ||
    existing.symbol !== request.symbol
  ) {
    throw new Error("Order submission is ambiguous; reconciliation required");
  }
  return { outcome: "submitted", signalId: signal.signalId, clientOrderId: request.clientOrderId };
}

async function ackSignalMessage(message: StreamMessage, deps: SignalMessageDeps): Promise<void> {
  await deps.bus.xAck(streams.signals, deps.group, message.id);
}

function readField(value: StreamFieldValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}

function validateExecutableSignal(signal: Signal): string | undefined {
  if (signal.intent.type === "STOP_MARKET") {
    return "unsupported-order-type";
  }

  if (signal.intent.type === "LIMIT" && signal.intent.limitPrice === undefined) {
    return "missing-limit-price";
  }

  return undefined;
}

async function evaluateRisk(signal: Signal, deps: SignalExecutionDeps): Promise<RiskDecision> {
  if (deps.riskGate === undefined) return { approved: false, reason: "risk-gate-unavailable" };
  return deps.riskGate.evaluate(signal);
}

function toGatewayOrderRequest(signal: Signal, clientOrderId: string): GatewayOrderRequest {
  const base = {
    clientOrderId,
    symbol: signal.intent.symbol,
    side: signal.intent.side,
    quantity: signal.intent.quantity
  };

  if (signal.intent.type === "LIMIT") {
    if (signal.intent.limitPrice === undefined) {
      throw new Error("Limit signal must include limitPrice");
    }

    return {
      ...base,
      type: "LIMIT",
      price: signal.intent.limitPrice,
      timeInForce: "GTC"
    };
  }

  return {
    ...base,
    type: "MARKET"
  };
}

function toPendingOrderRecord(
  signal: Signal,
  request: GatewayOrderRequest,
  attempt: number,
  createdAtMs: number
): PendingOrderRecord {
  return {
    clientOrderId: request.clientOrderId,
    strategyId: signal.strategyId,
    signalId: signal.signalId,
    attempt,
    symbol: request.symbol,
    side: request.side,
    type: request.type,
    quantity: request.quantity.toFixed(),
    ...(request.price === undefined ? {} : { limitPrice: request.price.toFixed() }),
    createdAtMs
  };
}
