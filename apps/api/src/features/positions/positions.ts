import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

interface PositionRow {
  readonly symbol: string;
  readonly quantity: string;
  readonly bought_quantity: string;
  readonly sold_quantity: string;
  readonly buy_quote: string;
  readonly sell_quote: string;
  readonly fill_count: string;
  readonly last_event_time_ms: string;
}

export function registerPositionsRoutes(server: FastifyInstance, pool: Pool): void {
  server.get("/api/positions", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");

    try {
      const result = await pool.query<PositionRow>(
        `
          SELECT
            symbol,
            SUM(CASE WHEN side = 'BUY' THEN quantity ELSE -quantity END)::text AS quantity,
            SUM(CASE WHEN side = 'BUY' THEN quantity ELSE 0 END)::text AS bought_quantity,
            SUM(CASE WHEN side = 'SELL' THEN quantity ELSE 0 END)::text AS sold_quantity,
            SUM(CASE WHEN side = 'BUY' THEN quantity * price ELSE 0 END)::text AS buy_quote,
            SUM(CASE WHEN side = 'SELL' THEN quantity * price ELSE 0 END)::text AS sell_quote,
            COUNT(*)::text AS fill_count,
            MAX(event_time_ms)::text AS last_event_time_ms
          FROM order_fills
          GROUP BY symbol
          ORDER BY symbol ASC
        `
      );

      return {
        checkedAt: Date.now(),
        positions: result.rows.map(toPosition)
      };
    } catch {
      return reply.code(503).send({
        error: "positions_unavailable",
        message: "Positions are unavailable"
      });
    }
  });
}

function toPosition(row: PositionRow) {
  return {
    symbol: row.symbol,
    quantity: row.quantity,
    boughtQuantity: row.bought_quantity,
    soldQuantity: row.sold_quantity,
    buyQuote: row.buy_quote,
    sellQuote: row.sell_quote,
    fillCount: Number(row.fill_count),
    lastEventTimeMs: Number(row.last_event_time_ms)
  };
}
