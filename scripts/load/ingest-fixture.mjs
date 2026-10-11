import { createServer } from "node:http";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { Buffer } from "node:buffer";
import { setInterval, clearInterval } from "node:timers";
import { Pool } from "../../apps/api/node_modules/pg/lib/index.js";
import { createClient, RESP_TYPES } from "../../apps/ingestor/node_modules/redis/dist/index.js";
import { Registry } from "../../packages/observability/node_modules/prom-client/index.js";
import { runMigrations } from "../../packages/db/src/migration-runner.js";
import { marketDataMigrations } from "../../packages/db/src/market-data-migrations.js";
import { createPostgresMigrationRunnerDeps } from "../../packages/db/src/postgres-adapter.js";
import { createPostgresMarketWriter } from "../../apps/ingestor/src/adapters/postgres-market-writer-factory.js";
import { createRedisXadd } from "../../apps/ingestor/src/adapters/redis-stream-adapter.js";
import { createRuntimeClients } from "../../apps/ingestor/src/runtime/runtime-clients.js";
import { createMarketIngestor } from "../../apps/ingestor/src/market/market-ingestor-factory.js";
import { createInstrumentedIngestor } from "../../apps/ingestor/src/market/instrumented-ingestor.js";
import { registerIngestorMetrics } from "../../apps/ingestor/src/runtime/metrics.js";
import { decodeMarketEvent } from "../../packages/proto/src/index.js";
import { createShutdownGuard } from "../../packages/observability/src/shutdown.js";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    statement_timeout: 5000
  });
  const redis = createClient({ url: process.env.REDIS_URL, disableOfflineQueue: true });
  redis.on("error", () => {});
  const clients = createRuntimeClients(
    {
      postgresUrl: process.env.DATABASE_URL,
      redisUrl: process.env.REDIS_URL,
      redisStreamMaxLen: 2000
    },
    {
      createPostgresPool: () => pool,
      createRedisCommandClient: () => ({
        connect: () => redis.connect(),
        quit: () => redis.quit(),
        sendCommand: (args) => redis.sendCommand([...args])
      })
    }
  );
  await clients.redis.connect();
  await runMigrations(marketDataMigrations, createPostgresMigrationRunnerDeps(pool));
  const registry = new Registry();
  const metrics = registerIngestorMetrics({ registry });
  const writer = createPostgresMarketWriter(clients.postgres);
  let busMs = 0;
  const ingestor = createInstrumentedIngestor(
    createMarketIngestor({
      xadd: createRedisXadd(clients.redis),
      ...writer,
      onPublished(kind, elapsed) {
        busMs = elapsed;
        metrics.recordBusLatency(kind, elapsed);
      }
    }),
    metrics
  );
  let sequence = 0,
    completed = 0,
    backlog = 0,
    maximumBacklog = 0,
    failed = 0,
    stopping = false;
  let pending = Promise.resolve();
  const samples = [];
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  let previousCpu = process.cpuUsage(),
    previousTime = performance.now();
  const sample = () => {
    const cpu = process.cpuUsage(),
      time = performance.now(),
      memory = process.memoryUsage();
    samples.push({
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      cpuPercent:
        (cpu.user - previousCpu.user + (cpu.system - previousCpu.system)) /
        (time - previousTime) /
        10,
      loopP95Ms: loop.percentile(95) / 1e6
    });
    previousCpu = cpu;
    previousTime = time;
    loop.reset();
    if (samples.length > 1200) throw new Error("benchmark_runtime_limit");
  };
  const timer = setInterval(sample, 100);
  const server = createServer((request, response) => {
    const received = performance.now();
    if (request.url === "/event" && request.method === "POST" && !stopping && backlog < 1000) {
      const id = ++sequence;
      const now = Date.now();
      backlog++;
      maximumBacklog = Math.max(maximumBacklog, backlog);
      pending = pending.then(async () => {
        try {
          await ingestor.ingest(
            {
              e: "trade",
              E: now,
              T: now,
              s: "BTCUSDT",
              t: id,
              p: "81000.01",
              q: "0.0002",
              m: false,
              M: true
            },
            received
          );
          completed++;
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ busMs, operationMs: performance.now() - received }));
        } catch {
          failed++;
          response.writeHead(500);
          response.end();
        } finally {
          backlog--;
        }
      });
    } else if (request.url === "/stats" && request.method === "GET") {
      void (async () => {
        await pending;
        const count = Number((await pool.query("SELECT count(*) FROM trades")).rows[0].count);
        const length = await redis.xLen("market.trade.BTCUSDT");
        const last = await redis
          .withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer })
          .sendCommand(["XREVRANGE", "market.trade.BTCUSDT", "+", "-", "COUNT", "1"]);
        const fields = last[0][1];
        const payload = fields[fields.findIndex((field) => field.toString() === "payload") + 1];
        const decoded = decodeMarketEvent(payload);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            completed,
            failed,
            dbCount: count,
            redisRetained: length,
            decodedKind: decoded.kind,
            maximumBacklog,
            samples,
            metrics: await registry.metrics()
          })
        );
      })().catch((error) => {
        console.error("Fixture stats failed:", error.message);
        response.writeHead(500);
        response.end();
      });
    } else {
      response.writeHead(stopping ? 503 : 404);
      response.end();
    }
  });
  const shutdown = createShutdownGuard({
    onStop() {
      stopping = true;
      void (async () => {
        clearInterval(timer);
        loop.disable();
        await new Promise((resolve) => {
          server.close(resolve);
          server.closeIdleConnections();
        });
        await pending;
        await clients.close();
        shutdown.finish();
        process.disconnect();
      })().catch(() => {
        process.exitCode = 1;
      });
    }
  });
  process.on("message", (message) => {
    if (message === "stop") shutdown.request();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.send({ port: server.address().port });
}
main().catch((error) => {
  console.error("Isolated ingestion fixture failed:", error.message);
  process.exit(1);
});
