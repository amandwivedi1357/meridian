import { createHash } from "node:crypto";

export type ClientOrderIdPrefix = string;

export interface ClientOrderIdInput {
  readonly prefix: ClientOrderIdPrefix;
  readonly strategyId: string;
  readonly signalId: string;
  readonly attempt: number;
}

const MAX_BINANCE_CLIENT_ORDER_ID_LENGTH = 36;
const PREFIX_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;

export function createClientOrderId(input: ClientOrderIdInput): string {
  validateInput(input);

  const hash = createHash("sha256")
    .update(input.strategyId, "utf8")
    .update("\0")
    .update(input.signalId, "utf8")
    .update("\0")
    .update(String(input.attempt), "utf8")
    .digest("base64url");

  const availableHashLength =
    MAX_BINANCE_CLIENT_ORDER_ID_LENGTH - input.prefix.length - 1;

  return `${input.prefix}_${hash.slice(0, availableHashLength)}`;
}

function validateInput(input: ClientOrderIdInput): void {
  if (!PREFIX_PATTERN.test(input.prefix)) {
    throw new Error("Client order id prefix must be 1-20 Binance-safe characters");
  }

  if (input.strategyId.trim() === "") {
    throw new Error("Strategy id is required for client order id generation");
  }

  if (input.signalId.trim() === "") {
    throw new Error("Signal id is required for client order id generation");
  }

  if (!Number.isSafeInteger(input.attempt) || input.attempt < 0) {
    throw new Error("Client order id attempt must be a non-negative safe integer");
  }
}