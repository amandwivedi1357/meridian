import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import { currentPrincipal, requireOperator } from "../../app/auth.js";

interface StrategyControlRow {
  readonly strategy_id: string;
  readonly paused: boolean;
  readonly reason: string;
  readonly updated_at_ms: string;
}

export function registerStrategyControlRoutes(server: FastifyInstance, pool: Pool): void {
  server.post(
    "/api/strategies/:strategyId/pause",
    { preHandler: requireOperator() },
    async (request, reply) => {
      const strategyId = readStrategyId(request.params);
      if (strategyId === null) {
        return reply.code(400).send({
          error: "invalid_strategy_id",
          message: "A valid strategy id is required"
        });
      }

      const reason = readReason(request.body);
      if (reason === null) {
        return reply.code(400).send({
          error: "invalid_reason",
          message: "A non-empty reason is required"
        });
      }

      const actor = currentPrincipal(request)?.actor ?? "unknown-api-operator";

      try {
        const result = await pool.query<StrategyControlRow>(
          `
            WITH changed AS (
              INSERT INTO strategy_control_state (strategy_id, paused, reason, updated_at)
              VALUES ($1, true, $2, now())
              ON CONFLICT (strategy_id) DO UPDATE
              SET paused = true,
                  reason = EXCLUDED.reason,
                  updated_at = now()
              RETURNING
                strategy_id,
                paused,
                reason,
                (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint::text AS updated_at_ms
            ),
            audit AS (
              INSERT INTO audit_log (actor, action, details)
              SELECT
                $3,
                'api-strategy-paused',
                jsonb_build_object('strategyId', $1::text, 'reason', $2::text)
              FROM changed
            ),
            event AS (
              INSERT INTO risk_events (type, details)
              SELECT
                'strategy-paused',
                jsonb_build_object(
                  'strategyId',
                  $1::text,
                  'reason',
                  $2::text,
                  'actor',
                  $3::text,
                  'source',
                  'api'
                )
              FROM changed
            )
            SELECT * FROM changed
          `,
          [strategyId, reason, actor]
        );

        const row = result.rows[0];
        if (row === undefined) throw new Error("Strategy control state unavailable");

        return {
          checkedAt: Date.now(),
          strategy: toStrategyControl(row)
        };
      } catch {
        return reply.code(503).send({
          error: "strategy_pause_unavailable",
          message: "Strategy could not be paused"
        });
      }
    }
  );

  server.post(
    "/api/strategies/:strategyId/resume",
    { preHandler: requireOperator() },
    async (request, reply) => {
      const strategyId = readStrategyId(request.params);
      if (strategyId === null) {
        return reply.code(400).send({
          error: "invalid_strategy_id",
          message: "A valid strategy id is required"
        });
      }

      const reason = readReason(request.body);
      if (reason === null) {
        return reply.code(400).send({
          error: "invalid_reason",
          message: "A non-empty reason is required"
        });
      }

      if (!hasResumeConfirmation(request.body)) {
        return reply.code(400).send({
          error: "missing_resume_confirmation",
          message: "Strategy resume requires explicit confirmation"
        });
      }

      const actor = currentPrincipal(request)?.actor ?? "unknown-api-operator";

      try {
        const result = await pool.query<StrategyControlRow>(
          `
            WITH changed AS (
              INSERT INTO strategy_control_state (strategy_id, paused, reason, updated_at)
              VALUES ($1, false, $2, now())
              ON CONFLICT (strategy_id) DO UPDATE
              SET paused = false,
                  reason = EXCLUDED.reason,
                  updated_at = now()
              RETURNING
                strategy_id,
                paused,
                reason,
                (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint::text AS updated_at_ms
            ),
            audit AS (
              INSERT INTO audit_log (actor, action, details)
              SELECT
                $3,
                'api-strategy-resumed',
                jsonb_build_object('strategyId', $1::text, 'reason', $2::text)
              FROM changed
            ),
            event AS (
              INSERT INTO risk_events (type, details)
              SELECT
                'strategy-resumed',
                jsonb_build_object(
                  'strategyId',
                  $1::text,
                  'reason',
                  $2::text,
                  'actor',
                  $3::text,
                  'source',
                  'api'
                )
              FROM changed
            )
            SELECT * FROM changed
          `,
          [strategyId, reason, actor]
        );

        const row = result.rows[0];
        if (row === undefined) throw new Error("Strategy control state unavailable");

        return {
          checkedAt: Date.now(),
          strategy: toStrategyControl(row)
        };
      } catch {
        return reply.code(503).send({
          error: "strategy_resume_unavailable",
          message: "Strategy could not be resumed"
        });
      }
    }
  );
}

function readStrategyId(params: FastifyRequest["params"]): string | null {
  if (params === null || typeof params !== "object" || !("strategyId" in params)) return null;
  const strategyId = (params as Record<string, unknown>).strategyId;
  if (typeof strategyId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(strategyId)) return null;
  return strategyId;
}

function readReason(body: FastifyRequest["body"]): string | null {
  if (body === null || typeof body !== "object" || !("reason" in body)) return null;
  const reason = (body as Record<string, unknown>).reason;
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  if (trimmed === "" || trimmed.length > 500) return null;
  return trimmed;
}

function hasResumeConfirmation(body: FastifyRequest["body"]): boolean {
  if (body === null || typeof body !== "object" || !("confirm" in body)) return false;
  return (body as Record<string, unknown>).confirm === "RESUME_STRATEGY";
}

function toStrategyControl(row: StrategyControlRow) {
  return {
    strategyId: row.strategy_id,
    paused: row.paused,
    reason: row.reason,
    updatedAtMs: Number(row.updated_at_ms)
  };
}
