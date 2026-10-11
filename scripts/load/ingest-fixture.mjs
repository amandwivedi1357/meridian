import { createServer } from "node:http";
import { Session } from "node:inspector";
import { writeFile, readFile } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
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
import { normalizeMarketStreamEvent } from "../../apps/ingestor/src/market/market-events.js";
import { createInstrumentedIngestor } from "../../apps/ingestor/src/market/instrumented-ingestor.js";
import { registerIngestorMetrics } from "../../apps/ingestor/src/runtime/metrics.js";
import { decodeMarketEvent } from "../../packages/proto/src/index.js";
import { marketBookStream, marketKlineStream } from "../../packages/bus/src/index.js";
import { createShutdownGuard } from "../../packages/observability/src/shutdown.js";

async function main() {
  const ablation = process.env.BENCHMARK_ABLATION || "full";
  if (!["full", "no-db", "no-redis", "normalize-only"].includes(ablation))
    throw new Error("invalid_benchmark_ablation");
  const databaseEnabled = ablation === "full" || ablation === "no-redis";
  const redisEnabled = ablation === "full" || ablation === "no-db";
  let stubPublications = 0;
  const stubWrites = { trade: 0, kline: 0 };
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
  const stages = { queue: [], redis: [], database: [] };
  const timed =
    (name, action) =>
    async (...args) => {
      const started = performance.now();
      try {
        return await action(...args);
      } finally {
        if (stages[name].length < 100000) stages[name].push(performance.now() - started);
      }
    };
  const profiler = new Session();
  const profiling = process.env.BENCHMARK_PROFILE !== "0";
  if (profiling) profiler.connect();
  const post = (method) =>
    new Promise((resolve, reject) =>
      profiler.post(method, (error, result) => (error ? reject(error) : resolve(result)))
    );
  if (profiling) {
    await post("Profiler.enable");
    await post("Profiler.start");
  }
  const context = new AsyncLocalStorage();
  const buffered = process.env.BENCHMARK_MODE !== "serial";
  const mixed = process.env.BENCHMARK_TOPICS === "mixed";
  const requestBatch = Number(process.env.BENCHMARK_BATCH || 1);
  const completedByKind = { trade: 0, depth: 0, kline: 0 };
  const onPublished = (kind, elapsed) => {
    context.getStore().busMs = elapsed;
    metrics.recordBusLatency(kind, elapsed);
  };
  const nullWriter = (kind) => async (rows) => {
    stubWrites[kind] += rows.length;
  };
  const ingestor = createInstrumentedIngestor(
    ablation === "normalize-only"
      ? {
          async ingest(input, receivedAtMs) {
            const event = normalizeMarketStreamEvent(input);
            onPublished(event.kind, performance.now() - receivedAtMs);
            return {
              event,
              publishResult: { stream: "diagnostic.normalize-only", id: "0-0" },
              batchWriteResult: { tradesWritten: 0, klinesWritten: 0, duplicatesSkipped: 0 }
            };
          }
        }
      : createMarketIngestor({
          xadd: timed(
            "redis",
            redisEnabled ? createRedisXadd(clients.redis) : async () => `${++stubPublications}-0`
          ),
          upsertTrades: timed(
            "database",
            databaseEnabled ? writer.upsertTrades : nullWriter("trade")
          ),
          upsertKlines: timed(
            "database",
            databaseEnabled ? writer.upsertKlines : nullWriter("kline")
          ),
          ...(buffered ? { buffer: { capacity: 1000, batchSize: 128, flushMs: 1 } } : {}),
          onPublished
        }),
    metrics
  );
  let sequence = 0,
    completed = 0,
    backlog = 0,
    maximumBacklog = 0,
    failed = 0,
    capacityRefused = 0,
    stopping = false;
  let pending = Promise.resolve();
  const inFlight = new Set();
  const samples = [];
  const cpuStat = async () => {
    for (const path of [
      "/sys/fs/cgroup/cpu.stat",
      "/sys/fs/cgroup/cpu/cpu.stat",
      "/sys/fs/cgroup/cpu,cpuacct/cpu.stat"
    ]) {
      try {
        return { path, content: await readFile(path, "utf8") };
      } catch {
        /* cgroup layout differs between Docker Desktop hosts. */
      }
    }
    return null;
  };
  const initialCpuStat = await cpuStat();
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
    if (request.url === "/ready") {
      response.writeHead(stopping ? 503 : 200);
      response.end();
    } else if (request.url === "/stop" && request.method === "POST") {
      response.writeHead(204);
      response.end();
      shutdown.request();
    } else if (
      request.url === "/event" &&
      request.method === "POST" &&
      !stopping &&
      backlog + requestBatch <= 1000
    ) {
      const works = [];
      for (let index = 0; index < requestBatch; index++) {
        const id = ++sequence;
        const now = Date.now();
        backlog++;
        maximumBacklog = Math.max(maximumBacklog, backlog);
        const execute = () =>
          context.run({ busMs: 0 }, async () => {
            if (stages.queue.length < 100000) stages.queue.push(performance.now() - received);
            try {
              const event =
                mixed && id % 10 === 0
                  ? {
                      e: "kline",
                      E: now,
                      s: "BTCUSDT",
                      k: {
                        t: 1700000040000 + Math.floor(id / 10) * 60000,
                        T: 1700000099999 + Math.floor(id / 10) * 60000,
                        s: "BTCUSDT",
                        i: "1m",
                        f: id,
                        L: id,
                        o: "81000",
                        c: "81000.01",
                        h: "81001",
                        l: "80999",
                        v: "0.1",
                        n: 1,
                        x: true,
                        q: "8100",
                        V: "0.05",
                        Q: "4050",
                        B: "0"
                      }
                    }
                  : mixed && id % 10 === 5
                    ? {
                        e: "depthUpdate",
                        E: now,
                        s: "BTCUSDT",
                        U: id,
                        u: id,
                        b: [["81000", "1"]],
                        a: [["81001", "1"]]
                      }
                    : {
                        e: "trade",
                        E: now,
                        T: now,
                        s: "BTCUSDT",
                        t: id,
                        p: "81000.01",
                        q: "0.0002",
                        m: false,
                        M: true
                      };
              const result = await ingestor.ingest(event, received);
              completed++;
              completedByKind[result.event.kind]++;
              return {
                busMs: context.getStore().busMs,
                operationMs: performance.now() - received
              };
            } catch (error) {
              failed++;
              throw error;
            } finally {
              backlog--;
            }
          });
        const work = buffered ? execute() : pending.then(execute);
        if (!buffered)
          pending = work.then(
            () => undefined,
            () => undefined
          );
        inFlight.add(work);
        works.push(work);
        void work.then(
          () => inFlight.delete(work),
          () => inFlight.delete(work)
        );
      }
      void Promise.all(works)
        .then((results) => {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify(requestBatch === 1 ? results[0] : { events: results }));
        })
        .catch(() => {
          response.writeHead(500);
          response.end();
        });
    } else if (
      request.url === "/event" &&
      request.method === "POST" &&
      !stopping &&
      backlog + requestBatch > 1000
    ) {
      capacityRefused += requestBatch;
      response.writeHead(503, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ reason: "ingestor_capacity", events: requestBatch }));
    } else if (request.url === "/stats" && request.method === "GET") {
      void (async () => {
        await pending;
        await Promise.allSettled([...inFlight]);
        const count = Number((await pool.query("SELECT count(*) FROM trades")).rows[0].count);
        const klineCount = Number((await pool.query("SELECT count(*) FROM klines")).rows[0].count);
        const length = await redis.xLen("market.trade.BTCUSDT");
        const last = await redis
          .withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer })
          .sendCommand(["XREVRANGE", "market.trade.BTCUSDT", "+", "-", "COUNT", "1"]);
        const fields = last?.[0]?.[1];
        const payload = fields?.[fields.findIndex((field) => field.toString() === "payload") + 1];
        const decoded = payload ? decodeMarketEvent(payload) : null;
        const entriesAdded = async (stream) => {
          if (!(await redis.exists(stream))) return 0;
          return (await redis.xInfoStream(stream))["entries-added"];
        };
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            completed,
            ablation,
            databaseEnabled,
            redisEnabled,
            stubPublications,
            stubWrites,
            initialCpuStat,
            finalCpuStat: await cpuStat(),
            failed,
            capacityRefused,
            dbCount: count,
            klineCount,
            completedByKind,
            redisEntriesAddedByKind: {
              trade: await entriesAdded("market.trade.BTCUSDT"),
              depth: await entriesAdded(marketBookStream("BTCUSDT")),
              kline: await entriesAdded(marketKlineStream("BTCUSDT", "1m"))
            },
            redisRetainedByKind: {
              trade: length,
              depth: await redis.xLen(marketBookStream("BTCUSDT")),
              kline: await redis.xLen(marketKlineStream("BTCUSDT", "1m"))
            },
            redisRetained: length,
            decodedKind: decoded?.kind ?? null,
            maximumBacklog,
            stages: Object.fromEntries(
              Object.entries(stages).map(([name, values]) => {
                const sorted = [...values].sort((a, b) => a - b);
                return [
                  name,
                  {
                    count: values.length,
                    averageMs: values.reduce((a, b) => a + b, 0) / values.length,
                    p95Ms: sorted[Math.floor((sorted.length - 1) * 0.95)],
                    maxMs: sorted.at(-1)
                  }
                ];
              })
            ),
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
        await Promise.allSettled([...inFlight]);
        await ingestor.drain?.();
        if (profiling) {
          const { profile } = await post("Profiler.stop");
          await writeFile(process.env.CPU_PROFILE_PATH, JSON.stringify(profile));
          profiler.disconnect();
        }
        await clients.close();
        shutdown.finish();
        if (process.connected) process.disconnect();
      })().catch(() => {
        process.exitCode = 1;
      });
    }
  });
  process.on("message", (message) => {
    if (message === "stop") shutdown.request();
  });
  await new Promise((resolve) =>
    server.listen(
      Number(process.env.FIXTURE_PORT || 0),
      process.env.FIXTURE_HOST || "127.0.0.1",
      resolve
    )
  );
  if (process.send) process.send({ port: server.address().port });
}
main().catch((error) => {
  console.error("Isolated ingestion fixture failed:", error.message);
  process.exit(1);
});
