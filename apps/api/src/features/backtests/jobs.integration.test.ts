import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { Pool } from "pg";
import { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { marketDataMigrations } from "@meridian/db";
import { Registry } from "@meridian/observability";
import { configureGateway } from "../../app/gateway.js";
import { registerApiAuth } from "../../app/auth.js";
import { registerBacktestJobs } from "./jobs.js";
import { registerBacktests } from "./backtests.js";
import { claimBacktestJob, createJobDispatcher } from "./job-dispatcher.js";
import { executeBacktestJob } from "./job-executor.js";
import { jobRequestSchema } from "./job-contracts.js";

const request = () => ({ requestId: randomUUID(), from: "2024-01-01", to: "2024-01-02" });
describe("bounded backtest requests", () => {
  it("normalizes the supported prototype defaults", () => {
    expect(jobRequestSchema.parse(request())).toMatchObject({
      strategy: "ema",
      symbol: "BTCUSDT",
      interval: "15m"
    });
  });
  it("accepts an exact 30-day range with the supported hourly interval", () => {
    expect(
      jobRequestSchema.safeParse({ ...request(), to: "2024-01-31", interval: "1h" }).success
    ).toBe(true);
  });
  it.each([
    { from: "2024-02-30" },
    { to: "2024-01-01" },
    { to: "2024-02-02" },
    { to: "2099-01-02" },
    { symbol: "ETHUSDT" },
    { interval: "1m" },
    { extra: true }
  ])("rejects invalid or unsupported input %j", (changes) => {
    expect(jobRequestSchema.safeParse({ ...request(), ...changes }).success).toBe(false);
  });
});

describe.skipIf(!process.env.API_TEST_DATABASE_URL || !process.env.API_TEST_REDIS_URL)(
  "isolated durable backtest jobs",
  () => {
    const namespace = `jobs_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: process.env.API_TEST_DATABASE_URL });
    const pool = new Pool({
      connectionString: process.env.API_TEST_DATABASE_URL,
      options: `-c search_path=${namespace}`
    });
    const redis = new Redis(process.env.API_TEST_REDIS_URL!);
    const server = Fastify();
    const config = { viewerToken: "v".repeat(40), operatorToken: "o".repeat(40) };
    const post = (payload = request(), token = config.operatorToken) =>
      server.inject({
        method: "POST",
        url: "/api/backtests/jobs",
        headers: { authorization: `Bearer ${token}` },
        payload
      });
    const get = (url: string) =>
      server.inject({ url, headers: { authorization: `Bearer ${config.viewerToken}` } });
    async function enqueue() {
      const response = await post();
      expect(response.statusCode).toBe(202);
      return response.json().job.jobId as string;
    }
    async function seedCandles() {
      await pool.query(`INSERT INTO klines SELECT 'BTCUSDT','15m',t,t+interval '899999 milliseconds',
      60000+500*sin(i/8.0),61000,59000,60000+500*sin(i/8.0),1,true
      FROM generate_series(0,95) AS i,
      LATERAL (SELECT '2024-01-01'::timestamptz+i*interval '15 minutes' AS t) AS times`);
    }
    it("rolls back results when cancellation arrives at the publication fence", async () => {
      await seedCandles();
      const id = await enqueue();
      const claim = await claimBacktestJob(pool);
      if (!claim) throw new Error("missing claim");
      const controller = new AbortController();
      const original = await pool.connect();
      const wrapped = {
        connect: async () => ({
          query: async (text: string, values?: unknown[]) => {
            const result = await original.query(text, values);
            if (text.includes("FOR UPDATE")) controller.abort();
            return result;
          },
          release: () => original.release()
        })
      } as unknown as Pool;
      await expect(
        executeBacktestJob(wrapped, id, claim.token, controller.signal)
      ).rejects.toThrow();
      expect(
        (await pool.query("SELECT count(*)::int AS count FROM backtest_runs")).rows[0].count
      ).toBe(0);
      expect(
        (await pool.query("SELECT state,error FROM backtest_jobs WHERE job_id=$1", [id])).rows[0]
      ).toEqual({ state: "failed", error: "worker_shutdown" });
    });
    beforeAll(async () => {
      await admin.query(`CREATE SCHEMA ${namespace}`);
      await pool.query(marketDataMigrations[1]!.sql);
      await pool.query(`CREATE TABLE audit_log (actor text,action text,details jsonb);
      CREATE TABLE klines (symbol text,interval text,open_time timestamptz,close_time timestamptz,
        open numeric,high numeric,low numeric,close numeric,volume numeric,closed boolean,
        UNIQUE(symbol,interval,open_time));`);
      await pool.query(marketDataMigrations[7]!.sql);
      await configureGateway(server, process.env.API_TEST_REDIS_URL!, {
        namespace: `${namespace}:rate:`,
        maxRequests: 1000
      });
      registerApiAuth(server, config);
      registerBacktestJobs(server, pool);
      registerBacktests(server, pool);
      await server.ready();
    });
    beforeEach(async () => {
      await pool.query(
        "TRUNCATE backtest_jobs,backtest_runs,backtest_fills,backtest_equity_points,audit_log,klines"
      );
      const keys = await redis.keys(`${namespace}:*`);
      if (keys.length) await redis.del(...keys);
    });
    afterAll(async () => {
      await server.close();
      const keys = await redis.keys(`${namespace}:*`);
      if (keys.length) await redis.del(...keys);
      redis.disconnect();
      await pool.end();
      try {
        await admin.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
      } finally {
        await admin.end();
      }
    });
    it("authorizes writes, rejects invalid requests and reports missing jobs", async () => {
      expect((await post(request(), config.viewerToken)).statusCode).toBe(403);
      expect((await post({ ...request(), from: "2024-02-30" })).statusCode).toBe(400);
      expect((await get(`/api/backtests/jobs/${randomUUID()}`)).statusCode).toBe(404);
      expect((await get("/api/backtests/jobs/not-a-uuid")).statusCode).toBe(400);
      expect((await pool.query("SELECT * FROM backtest_jobs")).rows).toHaveLength(0);
    });
    it("returns the same durable job on retry and refuses conflicting reuse", async () => {
      const payload = request();
      const first = await post(payload),
        second = await post(payload);
      expect(first.statusCode).toBe(202);
      expect(second.json().job.jobId).toBe(first.json().job.jobId);
      expect((await post({ ...payload, to: "2024-01-03" })).statusCode).toBe(409);
      expect((await pool.query("SELECT * FROM audit_log")).rows).toHaveLength(1);
      expect((await get(`/api/backtests/jobs/${first.json().job.jobId}`)).json().job.state).toBe(
        "queued"
      );
    });
    it("rolls back enqueue if auditing fails", async () => {
      await pool.query(`CREATE FUNCTION reject_job_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private failure'; END $$;
      CREATE TRIGGER reject_job_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_job_audit()`);
      try {
        const response = await post();
        expect(response.statusCode).toBe(503);
        expect(response.body).not.toContain("private failure");
        expect((await pool.query("SELECT * FROM backtest_jobs")).rows).toHaveLength(0);
      } finally {
        await pool.query(
          "DROP TRIGGER reject_job_audit ON audit_log; DROP FUNCTION reject_job_audit()"
        );
      }
    });
    it("caps the active queue without limiting terminal history", async () => {
      for (let i = 0; i < 20; i++)
        await pool.query(
          "INSERT INTO backtest_jobs(job_id,actor,request_id,request,state) VALUES($1,'fixture',$2,$3,'queued')",
          [randomUUID(), randomUUID(), request()]
        );
      expect((await post()).json().error).toBe("backtest_job_capacity");
      await pool.query("UPDATE backtest_jobs SET state='failed'");
      expect((await post()).statusCode).toBe(202);
    });
    it("serializes concurrent dispatchers and fails expired work without replaying it", async () => {
      await enqueue();
      await enqueue();
      const claims = await Promise.all([claimBacktestJob(pool), claimBacktestJob(pool)]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      const old = claims.find(Boolean)!;
      await pool.query(
        "UPDATE backtest_jobs SET lease_until=now()-interval '1 second' WHERE job_id=$1",
        [old.jobId]
      );
      const next = await claimBacktestJob(pool);
      expect(next!.jobId).not.toBe(old.jobId);
      expect(
        (await pool.query("SELECT state,error FROM backtest_jobs WHERE job_id=$1", [old.jobId]))
          .rows[0]
      ).toEqual({ state: "failed", error: "worker_lost" });
    });
    it("replays actual EMA candles and publishes a readable result atomically", async () => {
      await seedCandles();
      const id = await enqueue();
      const claim = (await claimBacktestJob(pool))!;
      await executeBacktestJob(pool, id, claim.token);
      const job = (await get(`/api/backtests/jobs/${id}`)).json().job;
      expect(job.state).toBe("succeeded");
      expect(job.summary.candleCount).toBe(96);
      expect(job.summary.tradeCount).toBeGreaterThan(0);
      expect((await get(`/api/backtests/${encodeURIComponent(job.runId)}`)).statusCode).toBe(200);
      expect(
        (await get(`/api/backtests/${encodeURIComponent(job.runId)}/equity`)).json().items
      ).toHaveLength(96);
      expect((await pool.query("SELECT * FROM backtest_fills")).rows.length).toBeGreaterThan(0);
    });
    it("refuses incomplete and misaligned history", async () => {
      await seedCandles();
      await pool.query("DELETE FROM klines WHERE open_time='2024-01-01'");
      let claim = (await enqueue(), (await claimBacktestJob(pool))!);
      await expect(executeBacktestJob(pool, claim.jobId, claim.token)).rejects.toThrow(
        "market_history_incomplete"
      );
      await pool.query("TRUNCATE klines");
      await seedCandles();
      await pool.query(
        "UPDATE klines SET open_time=open_time+interval '1 second' WHERE open_time='2024-01-01'"
      );
      claim = (await enqueue(), (await claimBacktestJob(pool))!);
      await expect(executeBacktestJob(pool, claim.jobId, claim.token)).rejects.toThrow(
        "market_history_incomplete"
      );
      expect((await pool.query("SELECT * FROM backtest_runs")).rows).toHaveLength(0);
    });
    it("fences displaced worker tokens without changing the current owner", async () => {
      await seedCandles();
      const id = await enqueue();
      const claim = (await claimBacktestJob(pool))!;
      const token = randomUUID();
      await pool.query("UPDATE backtest_jobs SET worker_token=$2 WHERE job_id=$1", [id, token]);
      await expect(executeBacktestJob(pool, id, claim.token)).rejects.toThrow("job_claim_lost");
      expect((await pool.query("SELECT state,worker_token FROM backtest_jobs")).rows[0]).toEqual({
        state: "running",
        worker_token: token
      });
      expect((await pool.query("SELECT * FROM backtest_runs")).rows).toHaveLength(0);
    });
    it("rechecks ownership after computation before publishing any result", async () => {
      await seedCandles();
      const id = await enqueue(),
        claim = (await claimBacktestJob(pool))!;
      const token = randomUUID();
      const fencedPool = {
        async connect() {
          const client = await pool.connect();
          let replaced = false;
          return {
            async query(text: string, values?: unknown[]) {
              const result = await client.query(text, values);
              if (text === "COMMIT" && !replaced) {
                replaced = true;
                await pool.query("UPDATE backtest_jobs SET worker_token=$2 WHERE job_id=$1", [
                  id,
                  token
                ]);
              }
              return result;
            },
            release() {
              client.release();
            }
          };
        }
      } as unknown as Pool;
      await expect(executeBacktestJob(fencedPool, id, claim.token)).rejects.toThrow(
        "job_claim_lost"
      );
      expect((await pool.query("SELECT * FROM backtest_runs")).rows).toHaveLength(0);
      expect(
        (await pool.query("SELECT state FROM backtest_jobs WHERE job_id=$1", [id])).rows[0].state
      ).toBe("running");
    });
    it("rolls back all results when publication fails", async () => {
      await seedCandles();
      const id = await enqueue();
      const claim = (await claimBacktestJob(pool))!;
      await pool.query(`CREATE FUNCTION reject_equity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private failure'; END $$;
      CREATE TRIGGER reject_equity BEFORE INSERT ON backtest_equity_points FOR EACH ROW EXECUTE FUNCTION reject_equity()`);
      try {
        await expect(executeBacktestJob(pool, id, claim.token)).rejects.toThrow();
        expect((await pool.query("SELECT * FROM backtest_runs")).rows).toHaveLength(0);
        expect((await pool.query("SELECT * FROM backtest_fills")).rows).toHaveLength(0);
        expect((await get(`/api/backtests/jobs/${id}`)).json().job).toMatchObject({
          state: "failed",
          error: "worker_failed",
          runId: null
        });
      } finally {
        await pool.query(
          "DROP TRIGGER reject_equity ON backtest_equity_points; DROP FUNCTION reject_equity()"
        );
      }
    });
    it("runs the compiled simulation subprocess and survives dispatcher recreation", async () => {
      await seedCandles();
      const id = await enqueue();
      const options = {
        pgOptions: `-c search_path=${namespace}`,
        intervalMs: 50
      };
      const stopped = createJobDispatcher(pool, process.env.API_TEST_DATABASE_URL!, options);
      await stopped.close();
      stopped.start();
      expect((await pool.query("SELECT state FROM backtest_jobs")).rows[0].state).toBe("queued");
      const registry = new Registry();
      const dispatcher = createJobDispatcher(pool, process.env.API_TEST_DATABASE_URL!, {
        ...options,
        metricsRegistry: registry
      });
      try {
        dispatcher.start();
        dispatcher.start();
        await expect
          .poll(
            async () =>
              (await pool.query("SELECT state FROM backtest_jobs WHERE job_id=$1", [id])).rows[0]
                .state,
            { timeout: 10000 }
          )
          .toBe("succeeded");
        await expect.poll(() => dispatcher.health().activeChildren).toBe(0);
        expect(dispatcher.health().status).toBe("ready");
        expect(await registry.metrics()).toContain(
          'meridian_backtest_process_exits_total{outcome="exit_zero"} 1'
        );
      } finally {
        await dispatcher.close();
      }
    }, 15000);
    it.each(["timeout", "shutdown"])("terminates a stalled child on %s", async (mode) => {
      const id = await enqueue();
      const registry = new Registry();
      const dispatcher = createJobDispatcher(pool, process.env.API_TEST_DATABASE_URL!, {
        metricsRegistry: registry,
        workerPath: fileURLToPath(new URL("./fixtures/stalled-worker.mjs", import.meta.url)),
        intervalMs: 50,
        timeoutMs: mode === "timeout" ? 500 : 10000
      });
      try {
        dispatcher.start();
        await expect
          .poll(
            async () =>
              (await pool.query("SELECT state FROM backtest_jobs WHERE job_id=$1", [id])).rows[0]
                .state
          )
          .toBe("running");
        if (mode === "shutdown") await dispatcher.close();
        await expect
          .poll(
            async () =>
              (await pool.query("SELECT state FROM backtest_jobs WHERE job_id=$1", [id])).rows[0]
                .state
          )
          .toBe("failed");
        expect(
          (await pool.query("SELECT error FROM backtest_jobs WHERE job_id=$1", [id])).rows[0].error
        ).toBe(mode === "timeout" ? "worker_timeout" : "api_shutdown");
        await expect.poll(() => dispatcher.health().activeChildren).toBe(0);
        expect(await registry.metrics()).toContain(
          `meridian_backtest_process_exits_total{outcome="${mode}"} 1`
        );
      } finally {
        await dispatcher.close();
      }
    });
  }
);
