import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { PortfolioReader } from "./portfolio.js";

interface CountRow {
  readonly count: string;
}

interface OrderStateCountRow {
  readonly state: string;
  readonly count: string;
}

interface RiskControlRow {
  readonly scope: string;
  readonly engaged: boolean;
  readonly reason: string;
  readonly updated_at_ms: string;
}

export function registerAccountSummaryRoutes(
  server: FastifyInstance,
  pool: Pool,
  portfolio: PortfolioReader
): void {
  server.get("/api/account/summary", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");

    try {
      const [orders, orderStates, fills, riskControl] = await Promise.all([
        pool.query<CountRow>("SELECT COUNT(*)::text AS count FROM orders"),
        pool.query<OrderStateCountRow>(
          `
            SELECT state, COUNT(*)::text AS count
            FROM orders
            GROUP BY state
            ORDER BY state ASC
          `
        ),
        pool.query<CountRow>("SELECT COUNT(*)::text AS count FROM order_fills"),
        pool.query<RiskControlRow>(
          `
            SELECT
              scope,
              engaged,
              reason,
              (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint::text AS updated_at_ms
            FROM risk_control_state
            WHERE scope = 'global'
            LIMIT 1
          `
        )
      ]);

      const valuation = await portfolio();

      return {
        checkedAt: Date.now(),
        orderCount: toCount(orders.rows[0]),
        fillCount: toCount(fills.rows[0]),
        ordersByState: Object.fromEntries(
          orderStates.rows.map((row) => [row.state, Number(row.count)])
        ),
        riskControl: riskControl.rows[0] === undefined ? null : toRiskControl(riskControl.rows[0]),
        positions: valuation.positions,
        portfolio: valuation
      };
    } catch {
      return reply.code(503).send({
        error: "account_summary_unavailable",
        message: "Account summary is unavailable"
      });
    }
  });
}

function toCount(row: CountRow | undefined): number {
  return Number(row?.count ?? 0);
}

function toRiskControl(row: RiskControlRow) {
  return {
    scope: row.scope,
    engaged: row.engaged,
    reason: row.reason,
    updatedAtMs: Number(row.updated_at_ms)
  };
}
