import {
  createTestnetTradingClientFromEnv,
  type BinanceOrderResponse
} from "@meridian/binance-client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import { currentPrincipal, requireOperator } from "../../app/auth.js";

export interface CancelOrderClient {
  readonly queryOrder: (input: {
    readonly symbol: string;
    readonly clientOrderId: string;
  }) => Promise<BinanceOrderResponse>;
  readonly cancelOrder: (input: {
    readonly symbol: string;
    readonly clientOrderId: string;
  }) => Promise<BinanceOrderResponse>;
  readonly close?: () => void | Promise<void>;
}

interface CancelOrderRow {
  readonly client_order_id: string;
  readonly symbol: string;
  readonly state: string;
}

interface ExistingOrderRow {
  readonly state: string;
}

export function registerCancelOrderRoute(
  server: FastifyInstance,
  pool: Pool,
  createClient: () => Promise<CancelOrderClient> = () =>
    createTestnetTradingClientFromEnv({ autoSynchronizeTime: true })
): void {
  server.post(
    "/api/orders/:clientOrderId/cancel",
    { preHandler: requireOperator() },
    async (request, reply) => {
      const clientOrderId = readClientOrderId(request.params);
      const reason = readCancelReason(request.body);
      if (clientOrderId === null || reason === null) {
        return reply.code(400).send({
          error: "invalid_cancel_order",
          message: "Order cancellation requires a valid client order id, reason and confirmation"
        });
      }

      const actor = currentPrincipal(request)?.actor ?? "unknown-api-operator";
      const claimed = await claimCancel(pool, { actor, clientOrderId, reason });
      if (claimed.outcome === "missing") {
        return reply.code(404).send({
          error: "order_not_found",
          message: "Order was not found"
        });
      }
      if (claimed.outcome === "not-cancelable") {
        return reply.code(409).send({
          error: "order_not_cancelable",
          message: `Order is ${claimed.state} and cannot be canceled`
        });
      }

      let client: CancelOrderClient | undefined;
      try {
        client = await createClient();
        const lookup = {
          symbol: claimed.order.symbol,
          clientOrderId: claimed.order.client_order_id
        };
        const observed = await client.queryOrder(lookup);
        const canceled = ["FILLED", "CANCELED", "EXPIRED", "REJECTED"].includes(observed.status)
          ? observed
          : await client.cancelOrder(lookup);
        await persistCanceledOrder(pool, canceled, actor, reason);
        return {
          checkedAt: Date.now(),
          status: "cancel-requested",
          order: {
            clientOrderId: claimed.order.client_order_id,
            symbol: canceled.symbol,
            state: canceled.status,
            exchangeOrderId: String(canceled.orderId),
            executedQuantity: canceled.executedQty,
            cumulativeQuoteQuantity: canceled.cummulativeQuoteQty
          }
        };
      } catch {
        return reply.code(503).send({
          error: "cancel_order_unavailable",
          message: "Order cancellation could not be confirmed"
        });
      } finally {
        await Promise.resolve(client?.close?.()).catch(() => undefined);
      }
    }
  );
}

async function claimCancel(
  pool: Pool,
  input: { readonly actor: string; readonly clientOrderId: string; readonly reason: string }
): Promise<
  | { readonly outcome: "claimed"; readonly order: CancelOrderRow }
  | { readonly outcome: "missing" }
  | { readonly outcome: "not-cancelable"; readonly state: string }
> {
  const result = await pool.query<CancelOrderRow>(
    `
      WITH claimed AS (
        UPDATE orders
        SET state = 'PENDING_CANCEL',
            updated_at = now()
        WHERE client_order_id = $1
          AND state IN ('NEW', 'PARTIALLY_FILLED', 'UNKNOWN', 'PENDING_CANCEL')
        RETURNING client_order_id, symbol, $2::text AS state
      ),
      audit AS (
        INSERT INTO audit_log (actor, action, details)
        SELECT
          $3,
          'api-order-cancel-requested',
          jsonb_build_object(
            'clientOrderId', client_order_id,
            'symbol', symbol,
            'previousState', state,
            'reason', $4::text
          )
        FROM claimed
      )
      SELECT client_order_id, symbol, state FROM claimed
    `,
    [input.clientOrderId, "PENDING_CANCEL", input.actor, input.reason]
  );
  const row = result.rows[0];
  if (row !== undefined) return { outcome: "claimed", order: row };

  const existing = await pool.query<ExistingOrderRow>(
    "SELECT state FROM orders WHERE client_order_id = $1",
    [input.clientOrderId]
  );
  const state = existing.rows[0]?.state;
  return state === undefined ? { outcome: "missing" } : { outcome: "not-cancelable", state };
}

async function persistCanceledOrder(
  pool: Pool,
  order: BinanceOrderResponse,
  actor: string,
  reason: string
) {
  const exchangeEventTimeMs = order.updateTime ?? order.transactTime ?? order.time ?? Date.now();
  const executionId = `cancel:${order.orderId}:${exchangeEventTimeMs}`;
  await pool.query(
    `
      WITH updated AS (
        UPDATE orders
        SET exchange_order_id = $2,
            state = $3,
            executed_quantity = $4,
            cumulative_quote_quantity = $5,
            last_exchange_event_time_ms = GREATEST(last_exchange_event_time_ms, $6),
            last_execution_id = $7,
            updated_at = $8
        WHERE client_order_id = $1
          AND last_exchange_event_time_ms <= $6
        RETURNING client_order_id, symbol, state
      )
      INSERT INTO audit_log (actor, action, details)
      SELECT
        $9,
        'api-order-cancel-confirmed',
        jsonb_build_object(
          'clientOrderId', client_order_id,
          'symbol', symbol,
          'state', state,
          'reason', $10::text
        )
      FROM updated
    `,
    [
      order.origClientOrderId ?? order.clientOrderId,
      String(order.orderId),
      order.status,
      order.executedQty,
      order.cummulativeQuoteQty,
      exchangeEventTimeMs,
      executionId,
      new Date(exchangeEventTimeMs),
      actor,
      reason
    ]
  );
}

function readClientOrderId(params: FastifyRequest["params"]): string | null {
  if (params === null || typeof params !== "object" || !("clientOrderId" in params)) return null;
  const value = (params as Record<string, unknown>).clientOrderId;
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,36}$/.test(value) ? value : null;
}

function readCancelReason(body: FastifyRequest["body"]): string | null {
  if (body === null || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (record.confirm !== "CANCEL_ORDER") return null;
  const reason = record.reason;
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  return trimmed !== "" && trimmed.length <= 300 ? trimmed : null;
}
