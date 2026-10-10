import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

interface FillRow {
  readonly client_order_id: string;
  readonly strategy_id: string;
  readonly execution_id: string;
  readonly trade_id: string;
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: string;
  readonly price: string;
  readonly fee: string;
  readonly fee_asset: string;
  readonly event_time_ms: string;
}

export function registerFillsRoutes(server: FastifyInstance, pool: Pool): void {
  server.get("/api/fills", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const limit = readLimit(request.query);

    try {
      const result = await pool.query<FillRow>(
        `
          SELECT
            f.client_order_id,
            o.strategy_id,
            f.execution_id,
            f.trade_id,
            f.symbol,
            f.side,
            f.quantity::text,
            f.price::text,
            f.fee::text,
            f.fee_asset,
            f.event_time_ms::text
          FROM order_fills f
          JOIN orders o USING (client_order_id)
          ORDER BY f.event_time_ms DESC
          LIMIT $1
        `,
        [limit]
      );

      return {
        checkedAt: Date.now(),
        fills: result.rows.map(toFill)
      };
    } catch {
      return reply.code(503).send({
        error: "fills_unavailable",
        message: "Fills are unavailable"
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

function toFill(row: FillRow) {
  return {
    clientOrderId: row.client_order_id,
    strategyId: row.strategy_id,
    executionId: row.execution_id,
    tradeId: row.trade_id,
    symbol: row.symbol,
    side: row.side,
    quantity: row.quantity,
    price: row.price,
    fee: row.fee,
    feeAsset: row.fee_asset,
    eventTimeMs: Number(row.event_time_ms)
  };
}
