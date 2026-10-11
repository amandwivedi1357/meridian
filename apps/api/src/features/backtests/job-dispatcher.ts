import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { JOB_LOCK } from "./jobs.js";
import type { Registry } from "@meridian/observability";
import { createWorkerMetrics } from "./worker-metrics.js";

export async function claimBacktestJob(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [JOB_LOCK]);
    await client.query(
      "UPDATE backtest_jobs SET state='failed',error='worker_lost',finished_at=now(),lease_until=NULL WHERE state='running' AND lease_until<=now()"
    );
    const running = await client.query("SELECT 1 FROM backtest_jobs WHERE state='running' LIMIT 1");
    if (running.rows.length) {
      await client.query("COMMIT");
      return null;
    }
    const queued = await client.query(
      "SELECT job_id FROM backtest_jobs WHERE state='queued' ORDER BY created_at,job_id LIMIT 1 FOR UPDATE SKIP LOCKED"
    );
    if (!queued.rows[0]) {
      await client.query("COMMIT");
      return null;
    }
    const claim = { jobId: String(queued.rows[0].job_id), token: randomUUID() };
    await client.query(
      "UPDATE backtest_jobs SET state='running',worker_token=$2,started_at=now(),lease_until=now()+interval '30 seconds' WHERE job_id=$1",
      [claim.jobId, claim.token]
    );
    await client.query("COMMIT");
    return claim;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function createJobDispatcher(
  pool: Pool,
  databaseUrl: string,
  options: {
    workerPath?: string;
    pgOptions?: string;
    intervalMs?: number;
    timeoutMs?: number;
    onUnavailable?: () => void;
    metricsRegistry?: Registry;
  } = {}
) {
  let stopped = false;
  let started = false;
  let lastSuccessfulTick = 0;
  let tickAvailable = false;
  const metrics = options.metricsRegistry
    ? createWorkerMetrics(options.metricsRegistry)
    : undefined;
  function health() {
    const age = lastSuccessfulTick ? Date.now() - lastSuccessfulTick : undefined;
    const ready =
      started &&
      !stopped &&
      tickAvailable &&
      age !== undefined &&
      age >= 0 &&
      age <= Math.max(10000, (options.intervalMs ?? 1000) * 3);
    metrics?.ready(ready);
    return {
      status: stopped
        ? ("stopping" as const)
        : ready
          ? ("ready" as const)
          : ("unavailable" as const),
      lastSuccessfulTickAtMs: lastSuccessfulTick || null,
      activeChildren: active?.running ? 1 : 0
    };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active:
    | { child: ChildProcess; jobId: string; token: string; done: Promise<void>; running: boolean }
    | undefined;
  let pending: Promise<void> | undefined;
  async function fail(jobId: string, token: string, reason: string) {
    await pool.query(
      "UPDATE backtest_jobs SET state='failed',error=$3,finished_at=now(),lease_until=NULL WHERE job_id=$1 AND worker_token=$2 AND state='running'",
      [jobId, token, reason]
    );
  }
  async function tick() {
    if (active) {
      await pool.query(
        "UPDATE backtest_jobs SET lease_until=now()+interval '30 seconds' WHERE job_id=$1 AND worker_token=$2 AND state='running' AND lease_until>now()",
        [active.jobId, active.token]
      );
      return;
    }
    const claim = await claimBacktestJob(pool);
    if (!claim) return;
    if (stopped) {
      await fail(claim.jobId, claim.token, "api_shutdown");
      return;
    }
    const processStarted = performance.now();
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=256",
        // Always launch compiled JS, including when the API is running under tsx watch.
        options.workerPath ??
          fileURLToPath(
            new URL("../../../dist/features/backtests/job-process.js", import.meta.url)
          ),
        claim.jobId,
        claim.token
      ],
      {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
        env: {
          DATABASE_URL: databaseUrl,
          ...(options.pgOptions ? { PGOPTIONS: options.pgOptions } : {}),
          ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {})
        }
      }
    );
    let timedOut = false;
    let spawnFailed = false;
    let exitCode: number | null = null;
    metrics?.active(1);
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs ?? 60000);
    const done = new Promise<void>((resolve) => {
      child.once("error", () => {
        spawnFailed = true;
        child.kill();
      });
      child.once("close", (code) => {
        if (active?.child === child) active.running = false;
        exitCode = code;
        clearTimeout(timeout);
        resolve();
      });
    }).then(async () => {
      metrics?.active(0);
      metrics?.exit(
        stopped
          ? "shutdown"
          : timedOut
            ? "timeout"
            : spawnFailed
              ? "spawn_error"
              : exitCode === 0
                ? "exit_zero"
                : "exit_nonzero",
        (performance.now() - processStarted) / 1000
      );
      await fail(
        claim.jobId,
        claim.token,
        stopped ? "api_shutdown" : timedOut ? "worker_timeout" : "worker_failed"
      ).catch(() => {});
      active = undefined;
    });
    active = { child, ...claim, done, running: true };
  }
  function schedule() {
    if (stopped) return;
    pending = tick()
      .then(() => {
        lastSuccessfulTick = Date.now();
        tickAvailable = true;
        metrics?.tick(true);
        health();
      })
      .catch(() => {
        tickAvailable = false;
        metrics?.tick(false);
        health();
        options.onUnavailable?.();
      })
      .finally(() => {
        pending = undefined;
        if (!stopped) timer = setTimeout(schedule, options.intervalMs ?? 1000);
      });
  }
  return {
    health,
    start() {
      if (!started && !stopped) {
        started = true;
        schedule();
      }
    },
    async close() {
      stopped = true;
      health();
      clearTimeout(timer);
      await pending;
      if (active) {
        active.child.kill();
        await active.done;
      }
    }
  };
}
