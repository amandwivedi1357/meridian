/* global __dirname */
const assert = require("node:assert/strict");
const { execFileSync, fork, spawn } = require("node:child_process");
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { setTimeout: sleep } = require("node:timers/promises");
const { setInterval, clearInterval } = require("node:timers");
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
async function wait(check, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
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
  const variant = process.env.BENCHMARK_VARIANT || "profile-buffered";
  const mode = process.env.BENCHMARK_MODE || "buffered";
  const ablation = process.env.BENCHMARK_ABLATION || "full";
  assert.ok(["full", "no-db", "no-redis", "normalize-only"].includes(ablation));
  const databaseEnabled = ablation === "full" || ablation === "no-redis";
  const redisEnabled = ablation === "full" || ablation === "no-db";
  assert.ok(["serial", "buffered"].includes(mode));
  const vus = Number(process.env.BENCHMARK_VUS || "4");
  assert.ok(Number.isSafeInteger(vus) && vus >= 1 && vus <= 256);
  const rate = Number(process.env.BENCHMARK_RATE || "0");
  assert.ok(Number.isSafeInteger(rate) && rate >= 0 && (rate <= 2000 || rate === 20000));
  const batch = Number(process.env.BENCHMARK_BATCH || "1");
  assert.ok([1, 20, 200].includes(batch) && (!rate || rate % batch === 0));
  const topics = process.env.BENCHMARK_TOPICS || "trade";
  assert.ok(["trade", "mixed"].includes(topics));
  const host = process.env.BENCHMARK_HOST || "windows";
  assert.ok(["windows", "linux"].includes(host));
  const linux = host === "linux";
  const profiling = process.env.BENCHMARK_PROFILE !== "0";
  const cpuPeriod = Number(process.env.BENCHMARK_CPU_PERIOD || "100000");
  assert.ok([10000, 100000].includes(cpuPeriod));
  const redisCpu = Number(process.env.BENCHMARK_REDIS_CPU || "0.25");
  assert.ok([0.125, 0.25, 0.5].includes(redisCpu));
  const ingestorCpu = 1.5 - redisCpu;
  const semiSpace = Number(process.env.BENCHMARK_SEMI_SPACE || "0");
  assert.ok([0, 32].includes(semiSpace));
  const nodeArgs = semiSpace ? [`--max-semi-space-size=${semiSpace}`] : [];
  const network = `meridian-benchmark-${id}`;
  let networkOwned = false;
  assert.match(variant, /^[a-z0-9-]+$/);
  const output = path.join(root, "logs/verification/phase-5", variant);
  await fs.mkdir(output, { recursive: true });
  await fs.rm(path.join(output, "result.json"), { force: true });
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
    if (linux) {
      docker("network", "create", "--label", label, network);
      networkOwned = true;
    }
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
        ...(linux
          ? [
              "--network",
              network,
              "--cpu-period",
              String(cpuPeriod),
              "--cpu-quota",
              String(cpuPeriod * (index === 0 ? redisCpu : 0.5)),
              "--memory",
              index === 0 ? "128m" : "512m",
              "--memory-swap",
              index === 0 ? "128m" : "512m"
            ]
          : ["-p", `127.0.0.1::${port}`]),
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
    let url, fixtureExit;
    if (linux) {
      names.push(`meridian-benchmark-${id}-ingestor`);
      owned.push(names[2]);
      docker(
        "run",
        "-d",
        "--name",
        names[2],
        "--label",
        label,
        "--network",
        network,
        "--cpu-period",
        String(cpuPeriod),
        "--cpu-quota",
        String(cpuPeriod * ingestorCpu),
        "--memory",
        "1408m",
        "--memory-swap",
        "1408m",
        "-p",
        "127.0.0.1::8000",
        "--mount",
        `type=bind,source=${output},target=/fixture`,
        "-e",
        `DATABASE_URL=postgres://fixture:fixture@${names[1]}:5432/fixture`,
        "-e",
        `REDIS_URL=redis://${names[0]}:6379`,
        "-e",
        "CPU_PROFILE_PATH=/fixture/ingestor.cpuprofile",
        "-e",
        `BENCHMARK_MODE=${mode}`,
        "-e",
        `BENCHMARK_ABLATION=${ablation}`,
        "-e",
        `BENCHMARK_TOPICS=${topics}`,
        "-e",
        `BENCHMARK_BATCH=${batch}`,
        "-e",
        `BENCHMARK_PROFILE=${profiling ? "1" : "0"}`,
        "-e",
        "FIXTURE_PORT=8000",
        "-e",
        "FIXTURE_HOST=0.0.0.0",
        "node:22-alpine",
        "node",
        ...nodeArgs,
        "/fixture/fixture.cjs"
      );
      url = `http://127.0.0.1:${port(2, 8000)}`;
      await wait(
        async () =>
          (await fetch(`${url}/ready`, { signal: AbortSignal.timeout(1000) })).status === 200
      );
    } else {
      fixture = fork(path.join(output, "fixture.cjs"), [], {
        execArgv: nodeArgs,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          CPU_PROFILE_PATH: path.join(output, "ingestor.cpuprofile"),
          BENCHMARK_MODE: mode,
          BENCHMARK_ABLATION: ablation,
          BENCHMARK_TOPICS: topics,
          BENCHMARK_BATCH: String(batch),
          BENCHMARK_PROFILE: profiling ? "1" : "0",
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
      fixtureExit = once(fixture, "exit");
      const ready = await Promise.race([
        once(fixture, "message").then(([message]) => message),
        fixtureExit.then(() => {
          throw new Error(`Fixture exited: ${fixtureLog}`);
        }),
        sleep(30000).then(() => {
          throw new Error("Fixture readiness timeout");
        })
      ]);
      url = `http://127.0.0.1:${ready.port}`;
    }
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
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          BENCHMARK_URL: url,
          BENCHMARK_VUS: String(vus),
          BENCHMARK_RATE: String(rate),
          BENCHMARK_BATCH: String(batch),
          BENCHMARK_BURST: rate === 20000 ? "1" : "0"
        },
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
    const response = await fetch(`${url}/stats`, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200);
    const stats = await response.json();
    await fs.writeFile(path.join(output, "fixture-stats.json"), JSON.stringify(stats));
    const summary = JSON.parse(await fs.readFile(path.join(output, "k6-summary.json"), "utf8"));
    const metric = (name) => summary.metrics[name].values ?? summary.metrics[name];
    assert.equal(stats.completed, metric("ingest_completed").count);
    assert.equal(stats.ablation, ablation);
    assert.equal(stats.dbCount, databaseEnabled ? stats.completedByKind.trade : 0);
    assert.equal(stats.klineCount, databaseEnabled ? stats.completedByKind.kline : 0);
    assert.equal(stats.stubPublications, ablation === "no-redis" ? stats.completed : 0);
    for (const kind of ["trade", "kline"])
      assert.equal(stats.stubWrites[kind], ablation === "no-db" ? stats.completedByKind[kind] : 0);
    assert.equal(stats.failed, 0);
    assert.equal(stats.capacityRefused, metric("ingest_capacity_refused").count);
    for (const kind of ["trade", "depth", "kline"])
      assert.equal(
        stats.redisEntriesAddedByKind[kind],
        redisEnabled ? stats.completedByKind[kind] : 0
      );
    assert.equal(stats.decodedKind, redisEnabled ? "trade" : null);
    assert.ok(stats.redisRetained <= 2100);
    for (const length of Object.values(stats.redisRetainedByKind)) assert.ok(length <= 2100);
    if (topics === "mixed" && redisEnabled)
      for (const length of Object.values(stats.redisRetainedByKind)) assert.ok(length > 0);
    let fixtureCode;
    if (linux) {
      assert.equal(
        (await fetch(`${url}/stop`, { method: "POST", signal: AbortSignal.timeout(5000) })).status,
        204
      );
      await wait(() => docker("inspect", "-f", "{{.State.Running}}", names[2]) === "false", 20000);
      fixtureCode = Number(docker("inspect", "-f", "{{.State.ExitCode}}", names[2]));
      assert.equal(docker("inspect", "-f", "{{.State.OOMKilled}}", names[2]), "false");
    } else {
      fixture.send("stop");
      [fixtureCode] = await Promise.race([
        fixtureExit,
        sleep(20000, undefined, { ref: false }).then(() => {
          throw new Error("Fixture shutdown timed out");
        })
      ]);
    }
    assert.equal(fixtureCode, 0);
    const profile = profiling
      ? JSON.parse(await fs.readFile(path.join(output, "ingestor.cpuprofile"), "utf8"))
      : { nodes: [], samples: [], timeDeltas: [] };
    const nodes = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
    const selfTime = new Map();
    for (let i = 0; i < profile.samples.length; i++) {
      const frame = nodes.get(profile.samples[i]);
      const key = `${frame.functionName || "(anonymous)"} (${frame.url}:${frame.lineNumber + 1})`;
      selfTime.set(key, (selfTime.get(key) || 0) + profile.timeDeltas[i]);
    }
    const droppedIterations =
      (summary.metrics.dropped_iterations?.values ?? summary.metrics.dropped_iterations)?.count ||
      0;
    result = {
      passed: code === 0,
      ablation,
      diagnosticOnly: ablation !== "full",
      databaseEnabled,
      redisEnabled,
      stubPublications: stats.stubPublications,
      stubWrites: stats.stubWrites,
      measurementMeaning: redisEnabled
        ? "Receipt to real Redis acknowledgement"
        : ablation === "no-redis"
          ? "Receipt to in-memory publication stub after normalization/encoding; NOT Redis latency"
          : "Receipt to normalization completion; no encoding, Redis or DB work",
      k6ExitCode: code,
      profiling,
      nodeArgs,
      checkedAt: new Date().toISOString(),
      tool,
      workload: `60s, ${rate ? `${rate}/s offered rate with 128-256 VUs` : `${vus} closed-loop k6 VUs`}, synthetic BTCUSDT ${topics === "mixed" ? "80% trade / 10% depth / 10% closed kline" : "trades"}, ${mode} ingestion, ablation=${ablation}, Redis ${redisEnabled ? "AOF" : "disabled"}, Timescale ${databaseEnabled ? "durable upserts" : "disabled"}, no recorder/exchange/engine/executor`,
      feederEventsPerRequest: batch,
      latencyOrigin:
        "HTTP receipt including generation/normalization of every event; all individual event samples returned, never batch-averaged",
      scope: `Local Docker Desktop ${host} prototype; grouped synthetic feeder, not browser paint, exchange latency, dedicated host or long-soak acceptance. Burst acceptance is explicit in targetChecks.`,
      resourceEnvelope: linux
        ? {
            totalCpuQuotas: 2,
            totalMemoryLimitsMiB: 2048,
            cpuPeriodUs: cpuPeriod,
            cpuAllocation: { ingestor: ingestorCpu, redis: redisCpu, database: 0.5 },
            note: "Combined ingestor/DB/Redis cgroup limits; k6, OS and shared Docker host excluded. Not a dedicated 2-vCPU VM."
          }
        : null,
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
      stages: stats.stages,
      cpuThrottling: { before: stats.initialCpuStat, after: stats.finalCpuStat },
      cpuProfile: profiling ? path.join(output, "ingestor.cpuprofile") : null,
      cpuTopSelfTime: [...selfTime.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([functionLocation, microseconds]) => ({
          functionLocation,
          selfMs: microseconds / 1000
        })),
      droppedIterations,
      unscheduledEvents: droppedIterations * batch,
      targetChecks: {
        receiptToBusP95Under10Ms: redisEnabled ? metric("ingest_bus_ms")["p(95)"] < 10 : null,
        twoThousandOfferedFor60sWithoutDrops:
          ablation === "full" &&
          rate === 2000 &&
          code === 0 &&
          droppedIterations === 0 &&
          stats.capacityRefused === 0 &&
          stats.completed >= 120000,
        controlledTwoCpuTwoGiBHost: false,
        combinedTwoCpuTwoGiBCgroupEnvelope: linux,
        mixedTopics: topics === "mixed",
        burst20k:
          ablation === "full" &&
          rate === 20000 &&
          code === 0 &&
          droppedIterations === 0 &&
          stats.completed + stats.capacityRefused >= 1200000 &&
          stats.failed === 0
      },
      dbCount: stats.dbCount,
      klineCount: stats.klineCount,
      completedByKind: stats.completedByKind,
      capacityRefused: stats.capacityRefused,
      redisEntriesAddedByKind: stats.redisEntriesAddedByKind,
      redisRetainedByKind: stats.redisRetainedByKind,
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
    if (networkOwned) {
      try {
        assert.equal(
          docker("network", "inspect", "-f", '{{index .Labels "meridian.benchmark"}}', network),
          id
        );
        docker("network", "rm", network);
      } catch {
        failures.push(network);
      }
    }
    assert.equal(failures.length, 0, `Cleanup failed: ${failures.join(",")}`);
  }
  result.cleanupComplete = true;
  await fs.writeFile(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, metrics: "saved in result.json" }));
  if (!result.passed) process.exitCode = 1;
}
// Docker fixtures have no IPC handle to keep the coordinator alive during fetch waits.
const keepAlive = setInterval(() => {}, 1000);
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => clearInterval(keepAlive));
