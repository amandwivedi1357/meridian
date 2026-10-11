import type { Pool } from "pg";
import { runBacktestCommand, type KlineRow } from "@meridian/backtest-worker";
import { jobRequestSchema } from "./job-contracts.js";

export async function executeBacktestJob(
  pool: Pool,
  jobId: string,
  token: string,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const client = await pool.connect();
  let transaction = false;
  try {
    const found = await client.query(
      "SELECT request FROM backtest_jobs WHERE job_id=$1 AND worker_token=$2 AND state='running' AND lease_until>now()",
      [jobId, token]
    );
    if (!found.rows[0]) throw new Error("job_claim_lost");
    const request = jobRequestSchema.parse(found.rows[0].request);
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transaction = true;
    const stepMs = request.interval === "15m" ? 900000 : 3600000;
    const coverage = await client.query(
      `SELECT COUNT(*)::int AS count,
      bool_and(mod(extract(epoch FROM (open_time-$3::timestamptz))*1000,$5::numeric)=0
        AND close_time=open_time+($5::numeric-1)*interval '1 millisecond') AS aligned FROM klines
      WHERE symbol=$1 AND interval=$2 AND open_time >= $3 AND open_time < $4 AND close_time < $4 AND closed=true`,
      [request.symbol, request.interval, new Date(request.from), new Date(request.to), stepMs]
    );
    const expected = (Date.parse(request.to) - Date.parse(request.from)) / stepMs;
    if (coverage.rows[0].count !== expected || !coverage.rows[0].aligned)
      throw new Error("market_history_incomplete");
    const writes: { text: string; values: readonly unknown[] }[] = [];
    const runId = `job:${jobId}`;
    const summary = await runBacktestCommand(
      [
        "--strategy",
        request.strategy,
        "--symbol",
        request.symbol,
        "--interval",
        request.interval,
        "--from",
        request.from,
        "--to",
        request.to,
        "--save-run",
        "--run-id",
        runId
      ],
      {
        ...(signal ? { signal } : {}),
        query: (text, values) => client.query<KlineRow>(text, [...values]),
        execute: async (query) => {
          writes.push(query);
        }
      }
    );
    await client.query("COMMIT");
    transaction = false;
    await client.query("BEGIN");
    transaction = true;
    // Fence stale/killed workers before publishing any result. Result and success are one commit.
    const lock = await client.query(
      "SELECT 1 FROM backtest_jobs WHERE job_id=$1 AND worker_token=$2 AND state='running' AND lease_until>now() FOR UPDATE",
      [jobId, token]
    );
    signal?.throwIfAborted();
    if (!lock.rows[0]) throw new Error("job_claim_lost");
    for (const query of writes) {
      signal?.throwIfAborted();
      await client.query(query.text, [...query.values]);
    }
    await client.query(
      "UPDATE backtest_jobs SET state='succeeded',run_id=$3,summary=$4::jsonb,finished_at=now(),lease_until=NULL WHERE job_id=$1 AND worker_token=$2",
      [jobId, token, runId, JSON.stringify(summary)]
    );
    signal?.throwIfAborted();
    await client.query("COMMIT");
    transaction = false;
  } catch (error) {
    if (transaction) await client.query("ROLLBACK").catch(() => {});
    const reason = signal?.aborted
      ? "worker_shutdown"
      : error instanceof Error && error.message === "market_history_incomplete"
        ? error.message
        : "worker_failed";
    await client
      .query(
        "UPDATE backtest_jobs SET state='failed',error=$3,finished_at=now(),lease_until=NULL WHERE job_id=$1 AND worker_token=$2 AND state='running'",
        [jobId, token, reason]
      )
      .catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
