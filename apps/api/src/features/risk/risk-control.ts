import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import { currentPrincipal, requireOperator } from "../../app/auth.js";

interface RiskControlRedis {
  readonly sendCommand: (args: readonly string[]) => Promise<unknown>;
}

interface KillStateRow {
  readonly scope: string;
  readonly engaged: boolean;
  readonly reason: string;
  readonly updated_at_ms: string;
}

export function registerRiskControlRoutes(
  server: FastifyInstance,
  pool: Pool,
  redis: RiskControlRedis
): void {
  server.post(
    "/api/risk/kill-switch/engage",
    { preHandler: requireOperator() },
    async (request, reply) => {
      const reason = readReason(request.body);
      if (reason === null) {
        return reply.code(400).send({
          error: "invalid_reason",
          message: "A non-empty reason is required"
        });
      }

      const actor = currentPrincipal(request)?.actor ?? "unknown-api-operator";

      try {
        const result = await pool.query<KillStateRow>(
          `
            WITH changed AS (
              UPDATE risk_control_state
              SET engaged = true,
                  reason = $1,
                  updated_at = now()
              WHERE scope = 'global'
              RETURNING
                scope,
                engaged,
                reason,
                (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint::text AS updated_at_ms
            ),
            audit AS (
              INSERT INTO audit_log (actor, action, details)
              SELECT
                $2,
                'api-kill-switch-engaged',
                jsonb_build_object('reason', $1::text)
              FROM changed
            ),
            event AS (
              INSERT INTO risk_events (type, details)
              SELECT
                'kill-switch-engaged',
                jsonb_build_object('reason', $1::text, 'actor', $2::text, 'source', 'api')
              FROM changed
            )
            SELECT * FROM changed
          `,
          [reason, actor]
        );
        const row = result.rows[0];
        if (row === undefined) throw new Error("Kill switch state unavailable");

        let redisUpdated = true;
        try {
          await redis.sendCommand(["SET", "meridian:risk:kill-switch", "1"]);
        } catch {
          redisUpdated = false;
        }

        return {
          checkedAt: Date.now(),
          redisUpdated,
          riskControl: toKillState(row)
        };
      } catch {
        return reply.code(503).send({
          error: "kill_switch_engage_unavailable",
          message: "Kill switch could not be engaged"
        });
      }
    }
  );
}

function readReason(body: FastifyRequest["body"]): string | null {
  if (body === null || typeof body !== "object" || !("reason" in body)) return null;
  const reason = (body as Record<string, unknown>).reason;
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  if (trimmed === "" || trimmed.length > 500) return null;
  return trimmed;
}

function toKillState(row: KillStateRow) {
  return {
    scope: row.scope,
    engaged: row.engaged,
    reason: row.reason,
    updatedAtMs: Number(row.updated_at_ms)
  };
}
