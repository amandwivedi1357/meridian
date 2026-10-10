import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

interface RiskEventRow {
  readonly id: string;
  readonly ts_ms: string;
  readonly type: string;
  readonly details: unknown;
}

export function registerRiskEventsRoutes(server: FastifyInstance, pool: Pool): void {
  server.get("/api/risk/events", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const limit = readLimit(request.query);

    try {
      const result = await pool.query<RiskEventRow>(
        `
          SELECT
            id::text,
            (EXTRACT(EPOCH FROM ts) * 1000)::bigint::text AS ts_ms,
            type,
            details
          FROM risk_events
          ORDER BY ts DESC
          LIMIT $1
        `,
        [limit]
      );

      return {
        checkedAt: Date.now(),
        events: result.rows.map(toRiskEvent)
      };
    } catch {
      return reply.code(503).send({
        error: "risk_events_unavailable",
        message: "Risk events are unavailable"
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

function toRiskEvent(row: RiskEventRow) {
  return {
    id: row.id,
    tsMs: Number(row.ts_ms),
    type: row.type,
    details: row.details
  };
}
