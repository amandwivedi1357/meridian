import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

interface StrategyRow {
  readonly strategy_id: string;
  readonly paused: boolean;
  readonly reason: string;
  readonly updated_at_ms: string;
}

export function registerStrategiesRoutes(server: FastifyInstance, pool: Pool): void {
  server.get("/api/strategies", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");

    try {
      const result = await pool.query<StrategyRow>(
        `
          SELECT
            strategy_id,
            paused,
            reason,
            (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint::text AS updated_at_ms
          FROM strategy_control_state
          ORDER BY strategy_id ASC
        `
      );

      return {
        checkedAt: Date.now(),
        strategies: result.rows.map(toStrategy)
      };
    } catch {
      return reply.code(503).send({
        error: "strategies_unavailable",
        message: "Strategies are unavailable"
      });
    }
  });
}

function toStrategy(row: StrategyRow) {
  return {
    strategyId: row.strategy_id,
    paused: row.paused,
    reason: row.reason,
    updatedAtMs: Number(row.updated_at_ms)
  };
}
