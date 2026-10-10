import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

interface RiskControlRow {
  readonly scope: string;
  readonly engaged: boolean;
  readonly reason: string;
  readonly updated_at_ms: string;
}

interface RiskEquityRow {
  readonly scope: string;
  readonly quote_asset: string;
  readonly peak: string;
  readonly updated_at_ms: string;
}

export function registerRiskStateRoutes(server: FastifyInstance, pool: Pool): void {
  server.get("/api/risk/state", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");

    try {
      const [control, equity] = await Promise.all([
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
        ),
        pool.query<RiskEquityRow>(
          `
            SELECT
              scope,
              quote_asset,
              peak::text,
              (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint::text AS updated_at_ms
            FROM risk_equity_state
            ORDER BY updated_at DESC
            LIMIT 20
          `
        )
      ]);

      return {
        checkedAt: Date.now(),
        control: control.rows[0] === undefined ? null : toControl(control.rows[0]),
        equity: equity.rows.map(toEquity)
      };
    } catch {
      return reply.code(503).send({
        error: "risk_state_unavailable",
        message: "Risk state is unavailable"
      });
    }
  });
}

function toControl(row: RiskControlRow) {
  return {
    scope: row.scope,
    engaged: row.engaged,
    reason: row.reason,
    updatedAtMs: Number(row.updated_at_ms)
  };
}

function toEquity(row: RiskEquityRow) {
  return {
    scope: row.scope,
    quoteAsset: row.quote_asset,
    peak: row.peak,
    updatedAtMs: Number(row.updated_at_ms)
  };
}
