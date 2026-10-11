import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { currentPrincipal, requireOperator } from "../../app/auth.js";
import { jobDto, jobRequestSchema, jobSchema } from "./job-contracts.js";

export const JOB_LOCK = 9041001;
export function registerBacktestJobs(server: FastifyInstance, pool: Pool) {
  const app = server.withTypeProvider<ZodTypeProvider>();
  app.post(
    "/api/backtests/jobs",
    {
      preHandler: requireOperator(),
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["Backtests"],
        body: jobRequestSchema,
        response: {
          202: z.object({ job: jobSchema }),
          409: z.object({ error: z.string() }),
          503: z.object({ error: z.string() })
        }
      }
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const actor = currentPrincipal(request)!.actor;
      let client;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [JOB_LOCK]);
        const existing = await client.query(
          "SELECT *,request=$3::jsonb AS matches FROM backtest_jobs WHERE actor=$1 AND request_id=$2",
          [actor, request.body.requestId, JSON.stringify(request.body)]
        );
        if (existing.rows[0]) {
          await client.query("COMMIT");
          if (!existing.rows[0].matches)
            return reply.code(409).send({ error: "idempotency_conflict" });
          return reply.code(202).send({ job: jobDto(existing.rows[0]) });
        }
        const capacity = await client.query(
          "SELECT COUNT(*)::int AS count FROM backtest_jobs WHERE state IN ('queued','running')"
        );
        if (capacity.rows[0].count >= 20) {
          await client.query("ROLLBACK");
          return reply.code(503).send({ error: "backtest_job_capacity" });
        }
        const result = await client.query(
          "INSERT INTO backtest_jobs (job_id,actor,request_id,request,state) VALUES ($1,$2,$3,$4::jsonb,'queued') RETURNING *",
          [randomUUID(), actor, request.body.requestId, JSON.stringify(request.body)]
        );
        await client.query(
          "INSERT INTO audit_log (actor,action,details) VALUES ($1,'api-backtest-job-submitted',$2::jsonb)",
          [actor, JSON.stringify({ jobId: result.rows[0].job_id, request: request.body })]
        );
        await client.query("COMMIT");
        return reply.code(202).send({ job: jobDto(result.rows[0]) });
      } catch {
        await client?.query("ROLLBACK").catch(() => {});
        return reply.code(503).send({ error: "backtest_job_unavailable" });
      } finally {
        client?.release();
      }
    }
  );
  app.get(
    "/api/backtests/jobs/:jobId",
    {
      schema: {
        tags: ["Backtests"],
        params: z.object({ jobId: z.string().uuid() }).strict(),
        response: {
          200: z.object({ job: jobSchema }),
          404: z.object({ error: z.string() }),
          503: z.object({ error: z.string() })
        }
      }
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        const result = await pool.query("SELECT * FROM backtest_jobs WHERE job_id=$1", [
          request.params.jobId
        ]);
        if (!result.rows[0]) return reply.code(404).send({ error: "backtest_job_not_found" });
        return { job: jobDto(result.rows[0]) };
      } catch {
        return reply.code(503).send({ error: "backtest_job_unavailable" });
      }
    }
  );
}
