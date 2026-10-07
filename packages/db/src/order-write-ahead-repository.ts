import type { SqlQuery } from "./migration-runner.js";

export interface PendingOrderRecord {
  readonly clientOrderId: string;
  readonly strategyId: string;
  readonly signalId: string;
  readonly attempt: number;
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly type: "MARKET" | "LIMIT";
  readonly quantity: string;
  readonly limitPrice?: string;
  readonly createdAtMs: number;
}

export interface OrderWriteAheadRepositoryDeps {
  readonly execute: (query: SqlQuery) => Promise<void>;
}

export function createOrderWriteAheadRepository(deps: OrderWriteAheadRepositoryDeps) {
  return {
    async recordPendingOrder(record: PendingOrderRecord): Promise<void> {
      validateRecord(record);

      await deps.execute({
        text: `
          INSERT INTO orders (
            client_order_id,
            strategy_id,
            signal_id,
            attempt,
            symbol,
            side,
            type,
            quantity,
            limit_price,
            state,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
          ON CONFLICT (client_order_id) DO NOTHING
        `,
        values: [
          record.clientOrderId,
          record.strategyId,
          record.signalId,
          record.attempt,
          record.symbol,
          record.side,
          record.type,
          record.quantity,
          record.limitPrice ?? null,
          "PENDING_NEW",
          new Date(record.createdAtMs),
        ],
      });
    },
  };
}

function validateRecord(record: PendingOrderRecord): void {
  if (record.clientOrderId.trim() === "") {
    throw new Error("clientOrderId is required");
  }

  if (record.strategyId.trim() === "") {
    throw new Error("strategyId is required");
  }

  if (record.signalId.trim() === "") {
    throw new Error("signalId is required");
  }

  if (!Number.isSafeInteger(record.attempt) || record.attempt < 0) {
    throw new Error("attempt must be a non-negative safe integer");
  }

  if (!/^[A-Z0-9]{2,30}$/.test(record.symbol)) {
    throw new Error("symbol must be an uppercase exchange symbol");
  }

  if (!/^\d+(?:\.\d+)?$/.test(record.quantity) || !/[1-9]/.test(record.quantity)) {
    throw new Error("quantity must be a positive decimal string");
  }

  if (
    record.type === "LIMIT" &&
    (record.limitPrice === undefined ||
      !/^\d+(?:\.\d+)?$/.test(record.limitPrice) ||
      !/[1-9]/.test(record.limitPrice))
  ) {
    throw new Error("limitPrice is required for limit orders");
  }

  if (!Number.isSafeInteger(record.createdAtMs) || record.createdAtMs < 0) {
    throw new Error("createdAtMs must be a non-negative safe integer");
  }
}