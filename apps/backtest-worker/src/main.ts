import { Pool } from "pg";
import { createShutdownGuard } from "@meridian/observability";
import { mkdir, writeFile } from "node:fs/promises";
import {
  createPostgresMigrationRunnerDeps,
  marketDataMigrations,
  runMigrations
} from "@meridian/db";
import type { KlineRow } from "./feeds/timescale-candle-feed.js";
import { runBacktestCommand } from "./cli/run-command.js";
import { runBacktestReportCommand } from "./cli/report-command.js";
import { runBacktestResultsCommand } from "./cli/results-command.js";

const controller = new AbortController();
const shutdown = createShutdownGuard({ onStop: () => controller.abort() });
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://meridian:meridian@localhost:5432/meridian",
  max: 1,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
  query_timeout: 15000
});

pool.on("error", (error) => {
  console.error("Database connection error:", error.message);
});
let transaction = false;

try {
  await runMigrations(marketDataMigrations, createPostgresMigrationRunnerDeps(pool));
  controller.signal.throwIfAborted();

  const args = process.argv.slice(2);
  const query = (text: string, values: readonly unknown[]) => {
    controller.signal.throwIfAborted();
    return pool.query<KlineRow>(text, [...values]);
  };
  const writes: { readonly text: string; readonly values: readonly unknown[] }[] = [];
  const execute = async (query: { readonly text: string; readonly values: readonly unknown[] }) => {
    controller.signal.throwIfAborted();
    writes.push(query);
  };

  const summary = await (args[0] === "report"
    ? runBacktestReportCommand(args.slice(1), {
        query(query) {
          controller.signal.throwIfAborted();
          return pool.query(query.text, [...query.values]);
        },
        async mkdir(path) {
          controller.signal.throwIfAborted();
          await mkdir(path, { recursive: true });
        },
        writeFile(path, contents) {
          controller.signal.throwIfAborted();
          return writeFile(path, contents, "utf8");
        }
      })
    : args[0] === "list" || args[0] === "show"
      ? runBacktestResultsCommand(args, {
          query(query) {
            controller.signal.throwIfAborted();
            return pool.query(query.text, [...query.values]);
          }
        })
      : runBacktestCommand(args, {
          query,
          execute,
          signal: controller.signal
        }));

  controller.signal.throwIfAborted();
  if (writes.length) {
    await pool.query("BEGIN");
    transaction = true;
    for (const write of writes) {
      controller.signal.throwIfAborted();
      await pool.query(write.text, [...write.values]);
    }
    controller.signal.throwIfAborted();
    await pool.query("COMMIT");
    transaction = false;
  }
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  if (transaction) await pool.query("ROLLBACK").catch(() => {});
  console.error("Backtest failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
} finally {
  await pool.end();
  shutdown.finish();
}
