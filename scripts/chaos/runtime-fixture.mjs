import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "../../apps/api/node_modules/pg/lib/index.js";
import Redis from "../../apps/api/node_modules/ioredis/built/index.js";
import { Registry } from "../../packages/observability/node_modules/prom-client/index.js";
import { createServiceDiagnostics } from "../../packages/observability/src/service-diagnostics.js";
import { createShutdownGuard } from "../../packages/observability/src/shutdown.js";
import { createOrderWriteAheadRepository } from "../../packages/db/src/order-write-ahead-repository.js";
import { createRiskRepository } from "../../packages/db/src/risk-repository.js";
import { marketDataMigrations } from "../../packages/db/src/market-data-migrations.js";
import { runMigrations } from "../../packages/db/src/migration-runner.js";
import { createPostgresMigrationRunnerDeps } from "../../packages/db/src/postgres-adapter.js";
import { createKillSwitch } from "../../apps/executor/src/kill-switch.js";

async function main() {
  // Only this internal Docker network is reachable; no project env file or exchange client.
  const pool = new Pool({
    connectionString: "postgres://fixture:fixture@database:5432/fixture",
    connectionTimeoutMillis: 500,
    statement_timeout: 1000,
    max: 2
  });
  const redis = new Redis("redis://redis:6379", {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: 500,
    commandTimeout: 500
  });
  redis.on("error", () => {});
  const execute = async (query) => pool.query(query.text, [...query.values]);
  const db = {
    execute,
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await work({ execute: async (q) => client.query(q.text, [...q.values]) });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }
  };
  const initialized = (await pool.query("SELECT to_regclass('orders') AS table_name")).rows[0]
    .table_name;
  if (!initialized) {
    await runMigrations(marketDataMigrations, createPostgresMigrationRunnerDeps(pool));
    await pool.query("UPDATE risk_control_state SET engaged=false,reason='isolated-fixture-only'");
    await redis.set("meridian:risk:kill-switch", "0");
  }
  const repository = createOrderWriteAheadRepository(db);
  const riskRepo = createRiskRepository(db);
  const kill = createKillSwitch({
    repo: riskRepo,
    command: (args) => redis.call(args[0], ...args.slice(1)),
    listOpenOrders: async () => [],
    cancelOrder: async () => {
      throw new Error("No exchange allowed");
    },
    alert: () => {},
    timeoutMs: 500
  });
  let hang = false;
  const diagnostics = createServiceDiagnostics({
    service: "isolated-runtime-fixture",
    registry: new Registry(),
    timeoutMs: 600,
    async checkReady() {
      await redis.ping();
      await pool.query("SELECT 1");
      return true;
    }
  });
  const controls = createServer((request, response) => {
    void (async () => {
      if (request.method !== "POST") {
        response.writeHead(405);
        response.end();
        return;
      }
      let result;
      if (request.url === "/cli") {
        const results = [];
        for (const name of ["backtest", "ingestor", "job", "api"]) {
          const lock = await pool.connect();
          let child;
          let childLog = "";
          try {
            if (name === "job") {
              await lock.query(
                `INSERT INTO backtest_jobs(job_id,actor,request_id,request,state,worker_token,lease_until)
                VALUES ('00000000-0000-4000-8000-000000000002','fixture','00000000-0000-4000-8000-000000000001',$1::jsonb,'running','00000000-0000-4000-8000-000000000003',now()+interval '1 minute')`,
                [
                  JSON.stringify({
                    strategy: "ema",
                    symbol: "BTCUSDT",
                    interval: "15m",
                    from: "2024-01-01",
                    to: "2024-01-02",
                    requestId: "00000000-0000-4000-8000-000000000001"
                  })
                ]
              );
            }
            await lock.query("BEGIN");
            await lock.query(
              `LOCK TABLE ${name === "job" ? "klines" : name === "api" ? "backtest_jobs" : "schema_migrations"} IN ACCESS EXCLUSIVE MODE`
            );
            const args =
              name === "backtest"
                ? ["--from", "2024-01-01", "--to", "2024-01-02"]
                : name === "job"
                  ? ["00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"]
                  : [];
            child = spawn(process.execPath, [`/fixture/${name}.mjs`, ...args], {
              env: {
                PATH: process.env.PATH,
                DATABASE_URL: "postgres://fixture:fixture@database:5432/fixture",
                REDIS_URL: "redis://redis:6379",
                JWT_SECRET: "isolated-fixture-only-secret",
                SHUTDOWN_TIMEOUT_MS: "2000",
                PGAPPNAME: `cli-${name}`
              },
              stdio: ["ignore", "pipe", "pipe"]
            });
            child.stdout.on("data", (data) => {
              childLog += data;
            });
            child.stderr.on("data", (data) => {
              childLog += data;
            });
            const exited = once(child, "exit");
            const deadline = Date.now() + 10000;
            let blocked = false;
            while (Date.now() < deadline && child.exitCode === null) {
              const active = await pool.query(
                "SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
                [`cli-${name}`]
              );
              if (active.rowCount) {
                blocked = true;
                break;
              }
              await delay(50);
            }
            if (!blocked)
              throw new Error(
                `CLI ${name} did not reach startup/read lock: ${childLog.slice(-1500)}`
              );
            const started = Date.now();
            child.kill("SIGTERM");
            await delay(100);
            await lock.query("ROLLBACK");
            const [code, signal] = await exited;
            const cancelled =
              name === "job"
                ? (
                    await lock.query(
                      "SELECT error FROM backtest_jobs WHERE job_id='00000000-0000-4000-8000-000000000002'"
                    )
                  ).rows[0]?.error === "worker_shutdown"
                : /aborted|startup cancelled/.test(childLog);
            results.push({ name, code, signal, cancelled, elapsedMs: Date.now() - started });
          } finally {
            await lock.query("ROLLBACK").catch(() => {});
            if (child && child.exitCode === null) child.kill("SIGKILL");
            lock.release();
          }
        }
        result = { results };
      } else if (request.url === "/hang") {
        hang = true;
        result = { hang: true };
      } else if (request.url === "/risk")
        result = { blocked: await kill.check(), durable: (await riskRepo.getKillState()).engaged };
      else if (request.url === "/events") {
        await repository.recordPendingOrder({
          clientOrderId: "fixture-order",
          strategyId: "fixture",
          signalId: "fixture-signal",
          attempt: 0,
          symbol: "BTCUSDT",
          side: "BUY",
          type: "MARKET",
          quantity: "1",
          createdAtMs: 1000
        });
        const update = {
          clientOrderId: "fixture-order",
          exchangeOrderId: "fixture-exchange",
          state: "FILLED",
          executedQuantity: "1",
          cumulativeQuoteQuantity: "100",
          exchangeEventTimeMs: 3000,
          executionId: "fixture-fill",
          fill: {
            tradeId: "fixture-trade",
            symbol: "BTCUSDT",
            side: "BUY",
            quantity: "1",
            price: "100",
            fee: "0",
            feeAsset: "USDT"
          }
        };
        await repository.recordOrderExecutionUpdate(update);
        await repository.recordOrderExecutionUpdate(update);
        await repository.recordOrderExecutionUpdate({
          ...update,
          state: "NEW",
          executedQuantity: "0",
          cumulativeQuoteQuantity: "0",
          exchangeEventTimeMs: 2000,
          executionId: "older",
          fill: undefined
        });
        result = {
          order: (
            await pool.query(
              "SELECT state,executed_quantity::text FROM orders WHERE client_order_id='fixture-order'"
            )
          ).rows[0],
          fills: Number((await pool.query("SELECT COUNT(*) FROM order_fills")).rows[0].count)
        };
      } else {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(result));
    })().catch((error) => {
      console.error("Fixture request failed:", error.message);
      response.writeHead(503);
      response.end(JSON.stringify({ error: "fixture-unavailable", reason: error.message }));
    });
  });
  await diagnostics.listen({ host: "0.0.0.0", port: 8080 });
  await new Promise((resolve) => controls.listen(8081, "0.0.0.0", resolve));
  diagnostics.started();
  const shutdown = createShutdownGuard({
    timeoutMs: 2000,
    onStop() {
      diagnostics.stopping();
      void diagnostics
        .ready()
        .then((ready) => console.log(JSON.stringify({ drainingReady: ready })));
      console.log(JSON.stringify({ stopping: true }));
      if (hang) return;
      void (async () => {
        await delay(600);
        await new Promise((resolve) => {
          controls.close(() => resolve());
          controls.closeAllConnections();
        });
        redis.disconnect();
        await pool.end();
        await diagnostics.close();
        shutdown.finish();
        console.log(JSON.stringify({ drained: true }));
      })().catch(() => {
        process.exitCode = 1;
      });
    }
  });
  console.log(JSON.stringify({ ready: true }));
}
main().catch((error) => {
  console.error("Isolated fixture startup failed:", error.message);
  process.exit(1);
});
