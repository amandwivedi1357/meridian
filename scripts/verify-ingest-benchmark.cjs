/* global __dirname */
const assert = require("node:assert/strict");
const { execFileSync, fork, spawn } = require("node:child_process");
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { setTimeout: sleep } = require("node:timers/promises");
const { fetch, AbortSignal } = globalThis;
const root = path.resolve(__dirname, "..");
const id = randomUUID().replaceAll("-", "");
const label = `meridian.benchmark=${id}`;
const names = [`meridian-benchmark-${id}-redis`, `meridian-benchmark-${id}-db`];
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000,
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
async function wait(check) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      /* Disposable fixture startup. */
    }
    await sleep(250);
  }
  throw new Error("Benchmark fixture startup timed out");
}
async function main() {
  const output = path.join(root, "logs/verification/phase-5/ingest-benchmark");
  await fs.mkdir(output, { recursive: true });
  const k6Binary = process.env.K6_BINARY || path.join(root, "logs/verification/tools/k6-sse.exe");
  await fs.access(k6Binary);
  const esbuild = require(
    path.join(root, "node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild")
  );
  await esbuild.build({
    entryPoints: [path.join(root, "scripts/load/ingest-fixture.mjs")],
    outfile: path.join(output, "fixture.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["pg-native"],
    logLevel: "silent"
  });
  let fixture, k6, result;
  const owned = [];
  try {
    for (const [index, image, port, args] of [
      [0, "redis:7-alpine", 6379, ["redis-server", "--appendonly", "yes"]],
      [
        1,
        "timescale/timescaledb:latest-pg16",
        5432,
        [
          "postgres",
          "-c",
          "shared_buffers=64MB",
          "-c",
          "max_worker_processes=8",
          "-c",
          "timescaledb.max_background_workers=4"
        ]
      ]
    ]) {
      owned.push(names[index]);
      docker(
        "run",
        "-d",
        "--name",
        names[index],
        "--label",
        label,
        "-p",
        `127.0.0.1::${port}`,
        ...(index === 1
          ? [
              "-e",
              "POSTGRES_USER=fixture",
              "-e",
              "POSTGRES_PASSWORD=fixture",
              "-e",
              "POSTGRES_DB=fixture"
            ]
          : []),
        image,
        ...args
      );
    }
    await wait(() => docker("exec", names[0], "redis-cli", "ping") === "PONG");
    await wait(() => {
      docker("exec", names[1], "pg_isready", "-h", "127.0.0.1", "-U", "fixture");
      return true;
    });
    const port = (index, internal) => {
      const binding = docker("port", names[index], `${internal}/tcp`);
      assert.match(binding, /^127\.0\.0\.1:\d+$/);
      return Number(binding.split(":")[1]);
    };
    fixture = fork(path.join(output, "fixture.cjs"), [], {
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        DATABASE_URL: `postgres://fixture:fixture@127.0.0.1:${port(1, 5432)}/fixture`,
        REDIS_URL: `redis://127.0.0.1:${port(0, 6379)}`
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true
    });
    let fixtureLog = "";
    fixture.stderr.on("data", (data) => {
      fixtureLog += data;
    });
    const fixtureExit = once(fixture, "exit");
    const ready = await Promise.race([
      once(fixture, "message").then(([message]) => message),
      fixtureExit.then(() => {
        throw new Error(`Fixture exited: ${fixtureLog}`);
      }),
      sleep(30000).then(() => {
        throw new Error("Fixture readiness timeout");
      })
    ]);
    const url = `http://127.0.0.1:${ready.port}`;
    const tool = execFileSync(k6Binary, ["version"], {
      encoding: "utf8",
      windowsHide: true
    }).trim();
    k6 = spawn(
      k6Binary,
      [
        "run",
        "--summary-export",
        path.join(output, "k6-summary.json"),
        "--summary-trend-stats",
        "avg,min,med,max,p(90),p(95),p(99)",
        path.join(root, "scripts/load/ingest-benchmark.js")
      ],
      {
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, BENCHMARK_URL: url },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      }
    );
    let log = "";
    k6.stdout.on("data", (data) => {
      log += data;
    });
    k6.stderr.on("data", (data) => {
      log += data;
    });
    const [code] = await Promise.race([
      once(k6, "exit"),
      sleep(90000, undefined, { ref: false }).then(() => {
        throw new Error("k6 runtime limit exceeded");
      })
    ]);
    await fs.writeFile(path.join(output, "k6.log"), log);
    assert.equal(code, 0, "k6 benchmark thresholds failed");
    const response = await fetch(`${url}/stats`, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200);
    const stats = await response.json();
    const summary = JSON.parse(await fs.readFile(path.join(output, "k6-summary.json"), "utf8"));
    const metric = (name) => summary.metrics[name].values ?? summary.metrics[name];
    assert.equal(stats.completed, metric("ingest_completed").count);
    assert.equal(stats.completed, stats.dbCount);
    assert.equal(stats.failed, 0);
    assert.equal(stats.decodedKind, "trade");
    assert.ok(stats.redisRetained <= 2100);
    fixture.send("stop");
    const [fixtureCode] = await Promise.race([
      fixtureExit,
      sleep(20000, undefined, { ref: false }).then(() => {
        throw new Error("Fixture shutdown timed out");
      })
    ]);
    assert.equal(fixtureCode, 0);
    result = {
      passed: true,
      checkedAt: new Date().toISOString(),
      tool,
      workload:
        "60s, 4 closed-loop k6 VUs, synthetic BTCUSDT trades, serialized ingestion, Redis AOF, Timescale durable per-event upserts, no recorder/exchange/engine/executor",
      scope:
        "Local Docker Desktop prototype; not maximum capacity, mixed-topic workload, browser paint or long-soak acceptance",
      events: stats.completed,
      eventsPerSecond: metric("ingest_completed").rate,
      busMs: metric("ingest_bus_ms"),
      operationMs: metric("ingest_operation_ms"),
      httpMs: metric("http_req_duration"),
      peakSampledRssMiB: Math.max(...stats.samples.map((s) => s.rss)) / 1048576,
      peakSampledHeapMiB: Math.max(...stats.samples.map((s) => s.heapUsed)) / 1048576,
      peakSampledCpuPercentOfOneCore: Math.max(...stats.samples.map((s) => s.cpuPercent)),
      peakSampledLoopP95Ms: Math.max(...stats.samples.map((s) => s.loopP95Ms)),
      sampleIntervalMs: 100,
      maximumBacklog: stats.maximumBacklog,
      dbCount: stats.dbCount,
      redisRetained: stats.redisRetained,
      shutdownCode: fixtureCode,
      containerSnapshots: names.map((name) => ({
        name,
        usage: docker("stats", "--no-stream", "--format", "{{json .}}", name)
      })),
      metrics: stats.metrics
    };
  } finally {
    if (k6 && k6.exitCode === null && k6.signalCode === null) {
      k6.kill();
      await once(k6, "exit");
    }
    if (fixture && fixture.exitCode === null && fixture.signalCode === null) {
      fixture.kill();
      await once(fixture, "exit");
    }
    const failures = [];
    for (const name of owned.reverse()) {
      try {
        if (!docker("ps", "-a", "--filter", `name=^/${name}$`, "--format", "{{.ID}}")) continue;
        assert.equal(
          docker("inspect", "-f", '{{index .Config.Labels "meridian.benchmark"}}', name),
          id
        );
        docker("rm", "-f", "-v", name);
      } catch {
        failures.push(name);
      }
    }
    assert.equal(failures.length, 0, `Cleanup failed: ${failures.join(",")}`);
  }
  result.cleanupComplete = true;
  await fs.writeFile(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, metrics: "saved in result.json" }));
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
