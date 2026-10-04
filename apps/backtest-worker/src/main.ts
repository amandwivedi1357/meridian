import { Pool } from "pg";
import type { KlineRow } from "./feeds/timescale-candle-feed.js";
import { runBacktestCommand } from "./cli/run-command.js";

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
  const summary = await runBacktestCommand(process.argv.slice(2), {
    query(text, values) {
      return pool.query<KlineRow>(text, [...values]);
    }
  });

  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error("Backtest failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
} finally {
  await pool.end();
}
