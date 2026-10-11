import { Pool } from "pg";
import { createShutdownGuard } from "@meridian/observability";
import { executeBacktestJob } from "./job-executor.js";

const [jobId, token] = process.argv.slice(2);
const controller = new AbortController();
const shutdown = createShutdownGuard({ onStop: () => controller.abort() });
if (!jobId || !token || !process.env.DATABASE_URL)
  throw new Error("Missing job process configuration");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000
});
pool.on("error", () => {});
try {
  await executeBacktestJob(pool, jobId, token, controller.signal);
} catch {
  process.exitCode = 1;
} finally {
  await pool.end();
  shutdown.finish();
}
