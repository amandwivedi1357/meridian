import type { LocalOrderForReconciliation, OrderState } from "@meridian/core";

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

export interface ReconciledTerminalOrderRecord {
  readonly clientOrderId: string;
  readonly terminalState: Extract<OrderState, "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED">;
  readonly reconciledAtMs: number;
}

export interface OrderExecutionUpdateRecord {
  readonly clientOrderId: string;
  readonly exchangeOrderId: string;
  readonly state: Extract<
    OrderState,
    "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED" | "UNKNOWN"
  >;
  readonly executedQuantity: string;
  readonly cumulativeQuoteQuantity: string;
  readonly exchangeEventTimeMs: number;
  readonly executionId: string;
  readonly fill?: {
    readonly tradeId: string;
    readonly symbol: string;
    readonly side: "BUY" | "SELL";
    readonly quantity: string;
    readonly price: string;
    readonly fee: string;
    readonly feeAsset: string;
  };
}

export interface OrderWriteAheadRepositoryDeps {
  readonly execute: (query: SqlQuery) => Promise<{
    readonly rowCount: number | null;
    readonly rows?: readonly unknown[];
  }>;
}

export function createOrderWriteAheadRepository(deps: OrderWriteAheadRepositoryDeps) {
  return {
    async claimOrderSubmission(clientOrderId: string): Promise<boolean> {
      if (clientOrderId.trim() === "") throw new Error("clientOrderId is required");
      // Persist ambiguity before network I/O: a crash must never authorize a second sender.
      const result = await deps.execute({
        text: `UPDATE orders SET state = 'UNKNOWN', updated_at = now()
               WHERE client_order_id = $1 AND state = 'PENDING_NEW'`,
        values: [clientOrderId]
      });
      if (result.rowCount === null) throw new Error("Submission claim result is unavailable");
      return result.rowCount === 1;
    },
    async recordOrderExecutionUpdate(record: OrderExecutionUpdateRecord): Promise<void> {
      validateOrderExecutionUpdate(record);

      await deps.execute({
        text: `
          UPDATE orders
          SET exchange_order_id = $2,
              state = $3,
              executed_quantity = $4,
              cumulative_quote_quantity = $5,
              last_exchange_event_time_ms = $6,
              last_execution_id = $7,
              updated_at = $8
          WHERE client_order_id = $1
            AND last_exchange_event_time_ms <= $6
        `,
        values: [
          record.clientOrderId,
          record.exchangeOrderId,
          record.state,
          record.executedQuantity,
          record.cumulativeQuoteQuantity,
          record.exchangeEventTimeMs,
          record.executionId,
          new Date(record.exchangeEventTimeMs)
        ]
      });

      if (record.fill !== undefined) {
        await deps.execute({
          text: `
            INSERT INTO order_fills (
              client_order_id,
              execution_id,
              trade_id,
              symbol,
              side,
              quantity,
              price,
              fee,
              fee_asset,
              event_time_ms
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (client_order_id, execution_id) DO NOTHING
          `,
          values: [
            record.clientOrderId,
            record.executionId,
            record.fill.tradeId,
            record.fill.symbol,
            record.fill.side,
            record.fill.quantity,
            record.fill.price,
            record.fill.fee,
            record.fill.feeAsset,
            record.exchangeEventTimeMs
          ]
        });
      }
    },

    async markOrderReconciledTerminal(record: ReconciledTerminalOrderRecord): Promise<void> {
      validateTerminalReconciliation(record);

      await deps.execute({
        text: `
          UPDATE orders
          SET state = $2,
              updated_at = $3
          WHERE client_order_id = $1
            AND state IN (
              'PENDING_NEW',
              'NEW',
              'PARTIALLY_FILLED',
              'PENDING_CANCEL',
              'UNKNOWN'
            )
        `,
        values: [record.clientOrderId, record.terminalState, new Date(record.reconciledAtMs)]
      });
    },

    async listOrdersForReconciliation(): Promise<readonly LocalOrderForReconciliation[]> {
      const result = await deps.execute({
        text: `
          SELECT
            client_order_id,
            symbol,
            state,
            (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint::text AS updated_at_ms
          FROM orders
          WHERE state IN (
            'PENDING_NEW',
            'NEW',
            'PARTIALLY_FILLED',
            'PENDING_CANCEL',
            'UNKNOWN'
          )
          ORDER BY updated_at ASC
        `,
        values: []
      });

      return (result.rows ?? []).map(readReconciliationRow);
    },

    async recordPendingOrder(record: PendingOrderRecord): Promise<void> {
      validateRecord(record);

      const result = await deps.execute({
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
          ON CONFLICT (client_order_id) DO UPDATE
          SET client_order_id = EXCLUDED.client_order_id
          WHERE orders.strategy_id = EXCLUDED.strategy_id
            AND orders.signal_id = EXCLUDED.signal_id
            AND orders.attempt = EXCLUDED.attempt
            AND orders.symbol = EXCLUDED.symbol
            AND orders.side = EXCLUDED.side
            AND orders.type = EXCLUDED.type
            AND orders.quantity = EXCLUDED.quantity
            AND orders.limit_price IS NOT DISTINCT FROM EXCLUDED.limit_price
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
          new Date(record.createdAtMs)
        ]
      });
      if (result.rowCount !== 1) {
        throw new Error("Write-ahead order identity conflict");
      }
    }
  };
}

function validateOrderExecutionUpdate(record: OrderExecutionUpdateRecord): void {
  if (record.clientOrderId.trim() === "") throw new Error("clientOrderId is required");
  if (record.exchangeOrderId.trim() === "") throw new Error("exchangeOrderId is required");
  if (!isExecutionOrderState(record.state))
    throw new Error("state must be an execution order state");
  if (!isNonNegativeDecimalString(record.executedQuantity)) {
    throw new Error("executedQuantity must be a non-negative decimal string");
  }
  if (!isNonNegativeDecimalString(record.cumulativeQuoteQuantity)) {
    throw new Error("cumulativeQuoteQuantity must be a non-negative decimal string");
  }
  if (!Number.isSafeInteger(record.exchangeEventTimeMs) || record.exchangeEventTimeMs < 0) {
    throw new Error("exchangeEventTimeMs must be a non-negative safe integer");
  }
  if (record.executionId.trim() === "") throw new Error("executionId is required");

  if (record.fill !== undefined) {
    if (record.fill.tradeId.trim() === "") throw new Error("tradeId is required");
    if (!/^[A-Z0-9]{2,30}$/.test(record.fill.symbol)) {
      throw new Error("fill symbol must be an uppercase exchange symbol");
    }
    if (!isPositiveDecimalString(record.fill.quantity)) {
      throw new Error("fill quantity must be a positive decimal string");
    }
    if (!isPositiveDecimalString(record.fill.price)) {
      throw new Error("fill price must be a positive decimal string");
    }
    if (!isNonNegativeDecimalString(record.fill.fee)) {
      throw new Error("fill fee must be a non-negative decimal string");
    }
    if (record.fill.feeAsset.trim() === "") throw new Error("fill feeAsset is required");
  }
}

function validateTerminalReconciliation(record: ReconciledTerminalOrderRecord): void {
  if (record.clientOrderId.trim() === "") {
    throw new Error("clientOrderId is required");
  }

  if (!isTerminalOrderState(record.terminalState)) {
    throw new Error("terminalState must be a terminal order state");
  }

  if (!Number.isSafeInteger(record.reconciledAtMs) || record.reconciledAtMs < 0) {
    throw new Error("reconciledAtMs must be a non-negative safe integer");
  }
}

function readReconciliationRow(value: unknown): LocalOrderForReconciliation {
  if (value === null || typeof value !== "object") {
    throw new Error("Invalid order reconciliation row");
  }

  const row = value as Record<string, unknown>;
  const clientOrderId = row.client_order_id;
  const symbol = row.symbol;
  const state = row.state;
  const updatedAtMs = row.updated_at_ms;

  if (
    typeof clientOrderId !== "string" ||
    clientOrderId.trim() === "" ||
    typeof symbol !== "string" ||
    !/^[A-Z0-9]{2,30}$/.test(symbol) ||
    !isOrderState(state) ||
    typeof updatedAtMs !== "string" ||
    !/^\d+$/.test(updatedAtMs)
  ) {
    throw new Error("Invalid order reconciliation row");
  }

  const parsedUpdatedAtMs = Number(updatedAtMs);

  if (!Number.isSafeInteger(parsedUpdatedAtMs)) {
    throw new Error("Invalid order reconciliation row");
  }

  return {
    clientOrderId,
    symbol,
    state,
    updatedAtMs: parsedUpdatedAtMs
  };
}

function isOrderState(value: unknown): value is OrderState {
  return (
    value === "PENDING_NEW" ||
    value === "NEW" ||
    value === "PARTIALLY_FILLED" ||
    value === "FILLED" ||
    value === "PENDING_CANCEL" ||
    value === "CANCELED" ||
    value === "REJECTED" ||
    value === "EXPIRED" ||
    value === "UNKNOWN"
  );
}

function isTerminalOrderState(
  value: unknown
): value is ReconciledTerminalOrderRecord["terminalState"] {
  return value === "FILLED" || value === "CANCELED" || value === "REJECTED" || value === "EXPIRED";
}

function isExecutionOrderState(value: unknown): value is OrderExecutionUpdateRecord["state"] {
  return (
    value === "NEW" ||
    value === "PARTIALLY_FILLED" ||
    value === "FILLED" ||
    value === "CANCELED" ||
    value === "REJECTED" ||
    value === "EXPIRED" ||
    value === "UNKNOWN"
  );
}

function isNonNegativeDecimalString(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value);
}

function isPositiveDecimalString(value: string): boolean {
  return isNonNegativeDecimalString(value) && /[1-9]/.test(value);
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
