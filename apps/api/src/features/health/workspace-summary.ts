import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { allocationFromEnv } from "@meridian/core";

const limitNames = [
  "MAX_NOTIONAL",
  "MAX_QUANTITY",
  "MAX_POSITION",
  "MAX_OPEN_ORDERS",
  "MAX_ORDERS_PER_MINUTE",
  "MAX_DAILY_LOSS",
  "MAX_DRAWDOWN"
] as const;
export function workspaceConfiguration(env: Record<string, string | undefined>) {
  let allocationMode = "Wallet ledger";
  try {
    if (allocationFromEnv(env)) allocationMode = "Configured Testnet allocation";
  } catch {
    allocationMode = "Invalid allocation configuration";
  }
  return {
    source: "API-host configuration; executor liveness not verified",
    marketEnvironment: ["production", "testnet"].includes(env.MARKET_DATA_ENV ?? "")
      ? env.MARKET_DATA_ENV
      : null,
    tradingEnvironment: ["production", "testnet"].includes(env.BINANCE_ENV ?? "")
      ? env.BINANCE_ENV
      : null,
    allocationMode,
    limits: Object.fromEntries(
      limitNames.map((name) => {
        const value = env[`EXECUTOR_${name}`];
        return [name, value && value.length <= 64 && /^\d+(\.\d+)?$/.test(value) ? value : null];
      })
    )
  };
}
export function registerWorkspaceSummary(
  server: FastifyInstance,
  pool: Pick<Pool, "query">,
  env: Record<string, string | undefined> = process.env
) {
  server.get("/api/system/workspace", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    const [audits, migrations] = await Promise.allSettled([
      pool.query(
        `SELECT id::text, (EXTRACT(EPOCH FROM ts)*1000)::bigint::text AS "tsMs", actor, action FROM audit_log ORDER BY ts DESC, id DESC LIMIT 20`
      ),
      pool.query(
        `SELECT id, applied_at AS "appliedAt" FROM schema_migrations ORDER BY id LIMIT 100`
      )
    ]);
    const auditSchema = z.object({
      id: z.string(),
      tsMs: z.string().regex(/^\d+$/),
      actor: z.string().max(200),
      action: z.string().max(200)
    });
    const migrationSchema = z.object({
      id: z.string().max(200),
      appliedAt: z
        .union([z.date(), z.string()])
        .transform((v) => (v instanceof Date ? v.toISOString() : v))
    });
    const audit =
      audits.status === "fulfilled" ? z.array(auditSchema).safeParse(audits.value.rows) : null;
    const migration =
      migrations.status === "fulfilled"
        ? z.array(migrationSchema).safeParse(migrations.value.rows)
        : null;
    return {
      checkedAt: Date.now(),
      configuration: workspaceConfiguration(env),
      audits: audit?.success ? audit.data : null,
      migrations: migration?.success ? migration.data : null
    };
  });
}
