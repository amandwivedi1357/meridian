import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

interface OrderRow {
  readonly client_order_id: string;
  readonly strategy_id: string;
  readonly signal_id: string;
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly type: "MARKET" | "LIMIT";
  readonly state: string;
  readonly quantity: string;
  readonly limit_price: string | null;
  readonly executed_quantity: string;
  readonly cumulative_quote_quantity: string;
  readonly exchange_order_id: string | null;
  readonly created_at_ms: string;
  readonly updated_at_ms: string;
}

export function registerOrdersRoutes(server: FastifyInstance, pool: Pool): void {
  server.get("/api/orders", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const limit = readLimit(request.query);

    try {
      const result = await pool.query<OrderRow>(
        `
          SELECT
            client_order_id,
            strategy_id,
            signal_id,
            symbol,
            side,
            type,
            state,
            quantity::text,
            limit_price::text,
            executed_quantity::text,
            cumulative_quote_quantity::text,
            exchange_order_id,
            (EXTRACT(EPOCH FROM created_at) * 1000)::bigint::text AS created_at_ms,
            (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint::text AS updated_at_ms
          FROM orders
          ORDER BY updated_at DESC
          LIMIT $1
        `,
        [limit]
      );

      return {
        checkedAt: Date.now(),
        orders: result.rows.map(toOrder)
      };
    } catch {
      return reply.code(503).send({
        error: "orders_unavailable",
        message: "Orders are unavailable"
      });
    }
  });
}

function readLimit(query: unknown): number {
  const raw =
    query !== null &&
    typeof query === "object" &&
    "limit" in query &&
    typeof query.limit === "string"
      ? Number(query.limit)
      : 50;

  if (!Number.isSafeInteger(raw) || raw <= 0) return 50;
  return Math.min(raw, 100);
}

function toOrder(row: OrderRow) {
  return {
    clientOrderId: row.client_order_id,
    strategyId: row.strategy_id,
    signalId: row.signal_id,
    symbol: row.symbol,
    side: row.side,
    type: row.type,
    state: row.state,
    quantity: row.quantity,
    limitPrice: row.limit_price,
    executedQuantity: row.executed_quantity,
    cumulativeQuoteQuantity: row.cumulative_quote_quantity,
    exchangeOrderId: row.exchange_order_id,
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms)
  };
}