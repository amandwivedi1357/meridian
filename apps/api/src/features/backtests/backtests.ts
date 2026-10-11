import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { createBacktestResultReader, renderBacktestHtmlReport } from "@meridian/backtest-worker";

const runParams = z.object({ runId: z.string().regex(/^[A-Za-z0-9:_\-.]{1,160}$/) }).strict();
const pageQuery = z
  .object({
    after: z.coerce.number().int().min(-1).max(Number.MAX_SAFE_INTEGER).default(-1),
    limit: z.coerce.number().int().min(1).max(1000).default(200)
  })
  .strict();
export function registerBacktests(server: FastifyInstance, pool: Pick<Pool, "query">) {
  const app = server.withTypeProvider<ZodTypeProvider>();
  app.get(
    "/api/backtests/:runId/report",
    { schema: { params: runParams, querystring: z.object({}).strict() } },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      reply.header(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'"
      );
      reply.header("X-Content-Type-Options", "nosniff");
      try {
        const exists = await pool.query("SELECT 1 FROM backtest_runs WHERE run_id=$1", [
          request.params.runId
        ]);
        if (!exists.rows.length) return reply.code(404).send({ error: "backtest_not_found" });
        const reader = createBacktestResultReader({
          query: async ({ text, values }) => {
            const history =
              text.includes("backtest_fills") || text.includes("backtest_equity_points");
            const result = await pool.query(history ? `${text} LIMIT 10001` : text, [...values]);
            if (history && result.rows.length > 10000) throw new Error("report_too_large");
            return result;
          }
        });
        const report = await reader.getReport(request.params.runId);
        return reply.type("text/html; charset=utf-8").send(renderBacktestHtmlReport(report));
      } catch {
        return reply.code(503).send({ error: "backtest_report_unavailable" });
      }
    }
  );
  app.get(
    "/api/backtests",
    {
      schema: {
        tags: ["Backtests"],
        querystring: z
          .object({ limit: z.coerce.number().int().min(1).max(100).default(20) })
          .strict()
      }
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        const result = await pool.query(
          `SELECT run_id AS "runId", strategy, symbol, interval, from_ms::text AS "fromMs", to_ms::text AS "toMs", metrics, created_at AS "createdAt"
        FROM backtest_runs ORDER BY created_at DESC,run_id LIMIT $1`,
          [request.query.limit]
        );
        return { runs: result.rows };
      } catch {
        return reply.code(503).send({ error: "backtests_unavailable" });
      }
    }
  );
  app.get(
    "/api/backtests/:runId",
    { schema: { tags: ["Backtests"], params: runParams, querystring: z.object({}).strict() } },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        const result = await pool.query(
          `SELECT run_id AS "runId", strategy, symbol, interval, from_ms::text AS "fromMs", to_ms::text AS "toMs", params,metrics,created_at AS "createdAt"
        FROM backtest_runs WHERE run_id=$1`,
          [request.params.runId]
        );
        if (!result.rows[0]) return reply.code(404).send({ error: "backtest_not_found" });
        return { run: result.rows[0] };
      } catch {
        return reply.code(503).send({ error: "backtest_unavailable" });
      }
    }
  );
  for (const kind of ["fills", "equity"] as const) {
    app.get(
      `/api/backtests/:runId/${kind}`,
      { schema: { tags: ["Backtests"], params: runParams, querystring: pageQuery } },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        try {
          if (
            !(
              await pool.query("SELECT 1 FROM backtest_runs WHERE run_id=$1", [
                request.params.runId
              ])
            ).rows.length
          )
            return reply.code(404).send({ error: "backtest_not_found" });
          const select =
            kind === "fills"
              ? `SELECT fill_index AS index, symbol,side,quantity::text,price::text,fee::text,fee_asset AS "feeAsset",ts_ms::text AS "tsMs"
          FROM backtest_fills WHERE run_id=$1 AND fill_index>$2 ORDER BY fill_index LIMIT $3`
              : `SELECT point_index AS index,ts_ms::text AS "tsMs",equity::text FROM backtest_equity_points WHERE run_id=$1 AND point_index>$2 ORDER BY point_index LIMIT $3`;
          const result = await pool.query(select, [
            request.params.runId,
            request.query.after,
            request.query.limit
          ]);
          return {
            items: result.rows,
            nextCursor:
              result.rows.length === request.query.limit ? result.rows.at(-1)?.index : null
          };
        } catch {
          return reply.code(503).send({ error: "backtest_history_unavailable" });
        }
      }
    );
  }
}
