import { Pool } from "pg";
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

try {
  await runMigrations(marketDataMigrations, createPostgresMigrationRunnerDeps(pool));

  const args = process.argv.slice(2);
  const query = (text: string, values: readonly unknown[]) =>
    pool.query<KlineRow>(text, [...values]);
  const execute = async (query: { readonly text: string; readonly values: readonly unknown[] }) => {
    await pool.query(query.text, [...query.values]);
  };

  const summary = await (args[0] === "report"
    ? runBacktestReportCommand(args.slice(1), {
        query(query) {
          return pool.query(query.text, [...query.values]);
        },
        async mkdir(path) {
          await mkdir(path, { recursive: true });
        },
        writeFile(path, contents) {
          return writeFile(path, contents, "utf8");
        }
      })
    : args[0] === "list" || args[0] === "show"
    ? runBacktestResultsCommand(args, {
        query(query) {
          return pool.query(query.text, [...query.values]);
        }
      })
    : runBacktestCommand(args, {
        query,
        execute
      }));

  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error("Backtest failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
} finally {
  await pool.end();
}
