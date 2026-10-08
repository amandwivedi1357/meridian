import { Decimal } from "decimal.js";
import type { OrderIntent, OrderType, Side, StrategyId, SymbolCode } from "./index.js";

export interface Signal {
  readonly signalId: string;
  readonly strategyId: StrategyId;
  readonly createdAtMs: number;
  readonly validUntilMs: number;
  readonly intent: OrderIntent;
}

export interface SerializedSignal {
  readonly signalId: string;
  readonly strategyId: string;
  readonly createdAtMs: number;
  readonly validUntilMs: number;
  readonly intent: {
    readonly symbol: string;
    readonly side: Side;
    readonly type: OrderType;
    readonly quantity: string;
    readonly limitPrice?: string;
    readonly stopPrice?: string;
    readonly reason: string;
  };
}

export function createSignal(input: Signal): Signal {
  validateSignal(input);
  return input;
}

export function serializeSignal(signal: Signal): SerializedSignal {
  const validSignal = createSignal(signal);

  return {
    signalId: validSignal.signalId,
    strategyId: validSignal.strategyId,
    createdAtMs: validSignal.createdAtMs,
    validUntilMs: validSignal.validUntilMs,
    intent: {
      symbol: validSignal.intent.symbol,
      side: validSignal.intent.side,
      type: validSignal.intent.type,
      quantity: validSignal.intent.quantity.toFixed(),
      ...(validSignal.intent.limitPrice === undefined
        ? {}
        : { limitPrice: validSignal.intent.limitPrice.toFixed() }),
      ...(validSignal.intent.stopPrice === undefined
        ? {}
        : { stopPrice: validSignal.intent.stopPrice.toFixed() }),
      reason: validSignal.intent.reason
    }
  };
}

export function parseSignalPayload(payload: string | Buffer): Signal {
  const text = Buffer.isBuffer(payload) ? payload.toString("utf8") : payload;
  const parsed = JSON.parse(text) as unknown;

  return parseSerializedSignal(parsed);
}

export function isSignalExpired(signal: Signal, nowMs: number): boolean {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error("nowMs must be a non-negative safe integer");
  }

  return nowMs > signal.validUntilMs;
}

export function validateSignal(signal: Signal): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(signal.signalId)) {
    throw new Error("signalId must be a nonempty URL-safe identifier");
  }

  if (signal.strategyId.trim() === "") {
    throw new Error("strategyId is required");
  }

  if (!Number.isSafeInteger(signal.createdAtMs) || signal.createdAtMs < 0) {
    throw new Error("createdAtMs must be a non-negative safe integer");
  }

  if (!Number.isSafeInteger(signal.validUntilMs) || signal.validUntilMs < 0) {
    throw new Error("validUntilMs must be a non-negative safe integer");
  }

  if (signal.validUntilMs <= signal.createdAtMs) {
    throw new Error("validUntilMs must be after createdAtMs");
  }

  if (signal.intent.reason.trim() === "") {
    throw new Error("signal intent reason is required");
  }

  if (!signal.intent.quantity.isFinite() || signal.intent.quantity.lte(0)) {
    throw new Error("signal intent quantity must be positive");
  }

  if (signal.intent.type === "LIMIT" && signal.intent.limitPrice === undefined) {
    throw new Error("signal limitPrice is required for limit orders");
  }

  if (
    signal.intent.limitPrice !== undefined &&
    (!signal.intent.limitPrice.isFinite() || signal.intent.limitPrice.lte(0))
  ) {
    throw new Error("signal limitPrice must be positive");
  }

  if (
    signal.intent.stopPrice !== undefined &&
    (!signal.intent.stopPrice.isFinite() || signal.intent.stopPrice.lte(0))
  ) {
    throw new Error("signal stopPrice must be positive");
  }
}

function parseSerializedSignal(value: unknown): Signal {
  if (value === null || typeof value !== "object") {
    throw new Error("Signal payload must be an object");
  }

  const record = value as Record<string, unknown>;
  const intent = record.intent;

  if (intent === null || typeof intent !== "object") {
    throw new Error("Signal intent payload must be an object");
  }

  const intentRecord = intent as Record<string, unknown>;
  const signal: Signal = {
    signalId: readRequiredString(record, "signalId"),
    strategyId: readRequiredString(record, "strategyId"),
    createdAtMs: readRequiredSafeInteger(record, "createdAtMs"),
    validUntilMs: readRequiredSafeInteger(record, "validUntilMs"),
    intent: {
      symbol: readSymbol(intentRecord, "symbol"),
      side: readSide(intentRecord, "side"),
      type: readOrderType(intentRecord, "type"),
      quantity: readDecimal(intentRecord, "quantity"),
      ...(intentRecord.limitPrice === undefined
        ? {}
        : { limitPrice: readDecimal(intentRecord, "limitPrice") }),
      ...(intentRecord.stopPrice === undefined
        ? {}
        : { stopPrice: readDecimal(intentRecord, "stopPrice") }),
      reason: readRequiredString(intentRecord, "reason")
    }
  };

  return createSignal(signal);
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`Signal payload ${key} must be a string`);
  }
  return value;
}

function readRequiredSafeInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Signal payload ${key} must be a non-negative safe integer`);
  }
  return value as number;
}

function readSymbol(record: Record<string, unknown>, key: string): SymbolCode {
  const value = readRequiredString(record, key);
  if (!/^[A-Z0-9]{2,30}$/.test(value)) {
    throw new Error("Signal payload symbol must be an uppercase exchange symbol");
  }
  return value;
}

function readSide(record: Record<string, unknown>, key: string): Side {
  const value = readRequiredString(record, key);
  if (value !== "BUY" && value !== "SELL") {
    throw new Error("Signal payload side must be BUY or SELL");
  }
  return value;
}

function readOrderType(record: Record<string, unknown>, key: string): OrderType {
  const value = readRequiredString(record, key);
  if (value !== "MARKET" && value !== "LIMIT" && value !== "STOP_MARKET") {
    throw new Error("Signal payload type is unsupported");
  }
  return value;
}

function readDecimal(record: Record<string, unknown>, key: string): Decimal {
  const value = readRequiredString(record, key);
  return new Decimal(value);
}
