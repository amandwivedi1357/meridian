/* global __dirname, __filename, setTimeout, setInterval, clearTimeout, clearInterval */
const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const { fork, spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "..");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const { Pool } = require(path.join(root, "apps/api/node_modules/pg"));
const Redis = require(path.join(root, "apps/api/node_modules/ioredis"));

async function main() {
  assert.ok(
    process.env.API_TEST_DATABASE_URL && process.env.API_TEST_REDIS_URL && process.env.K6_BINARY,
    "Explicit test URLs and K6_BINARY required"
  );
  const namespace = `sse_load_${randomUUID().replaceAll("-", "")}`;
  const output = path.join(root, "logs/verification/phase-4-2");
  await fs.mkdir(output, { recursive: true });
  const admin = new Pool({
    connectionString: process.env.API_TEST_DATABASE_URL,
    connectionTimeoutMillis: 2000
  });
  const pool = new Pool({
    connectionString: process.env.API_TEST_DATABASE_URL,
    options: `-c search_path=${namespace}`,
    connectionTimeoutMillis: 2000
  });
  const redis = new Redis(process.env.API_TEST_REDIS_URL, {
    connectTimeout: 2000,
    commandTimeout: 2000,
    maxRetriesPerRequest: 1
  });
  const config = {
    namespace,
    port: 0,
    loadTest: true,
    viewerToken: randomBytes(32).toString("hex"),
    operatorToken: randomBytes(32).toString("hex"),
    jwtSecret: randomBytes(32).toString("hex"),
    allowedOrigins: []
  };
  const samples = [];
  let api,
    k6,
    timer,
    progress,
    publishing = false,
    publishError,
    created = false,
    tradeId = 0,
    depthId = 0;
  const shared = async () => ({
    state: (
      await admin.query(`SELECT
    (SELECT count(*)::int FROM public.orders) AS orders,
    (SELECT count(*)::int FROM public.order_fills) AS fills,
    (SELECT count(*)::int FROM public.audit_log) AS audits,
    (SELECT count(*)::int FROM public.risk_events) AS events,
    (SELECT jsonb_agg(s ORDER BY s.scope) FROM public.risk_control_state s) AS risk,
    (SELECT jsonb_agg(s ORDER BY s.strategy_id) FROM public.strategy_control_state s) AS strategies`)
    ).rows[0],
    kill: await redis.get("meridian:risk:kill-switch")
  });
  const publish = async (finish = false) => {
    const now = Date.now();
    const pipe = redis.pipeline();
    for (let index = 0; index < (finish ? 1 : 5); index++) {
      const id = finish ? "999999999" : String(++tradeId);
      const event = {
        kind: "trade",
        symbol: "BTCUSDT",
        eventId: `trade-${id}`,
        occurredAtMs: now,
        trade: {
          symbol: "BTCUSDT",
          tradeId: id,
          price: "81000.01",
          quantity: "0.0002",
          eventTimeMs: now,
          isBuyerMaker: false
        }
      };
      pipe.xadd(
        `${namespace}:market.trade.BTCUSDT`,
        "MAXLEN",
        "=",
        2000,
        "*",
        "payload",
        JSON.stringify(event)
      );
    }
    if (!finish && tradeId % 20 === 0) {
      const id = ++depthId;
      pipe.xadd(
        `${namespace}:market.book.BTCUSDT`,
        "MAXLEN",
        "=",
        2000,
        "*",
        "payload",
        JSON.stringify({
          kind: "depth",
          symbol: "BTCUSDT",
          eventId: `depth-${id}`,
          occurredAtMs: now,
          depth: {
            firstUpdateId: id,
            finalUpdateId: id,
            bids: [{ price: "81000", quantity: "1" }],
            asks: [{ price: "81001", quantity: "1" }]
          }
        })
      );
      const openTimeMs = Math.floor(now / 900000) * 900000;
      pipe.xadd(
        `${namespace}:market.kline.BTCUSDT.15m`,
        "MAXLEN",
        "=",
        2000,
        "*",
        "payload",
        JSON.stringify({
          kind: "kline",
          symbol: "BTCUSDT",
          eventId: `kline-${id}`,
          occurredAtMs: now,
          candle: {
            symbol: "BTCUSDT",
            interval: "15m",
            openTimeMs,
            closeTimeMs: openTimeMs + 899999,
            open: "81000",
            high: "81002",
            low: "80999",
            close: "81001",
            volume: "1",
            closed: false
          }
        })
      );
      await pool.query(
        "UPDATE risk_control_state SET reason=$1, updated_at=NOW() WHERE scope='global'",
        [`load-${id}`]
      );
    }
    const replies = await pipe.exec();
    assert.ok(
      replies.every(([error]) => !error),
      "Fixture publish failed"
    );
    if (finish)
      await pool.query(
        "UPDATE risk_control_state SET reason='load-complete', updated_at=NOW() WHERE scope='global'"
      );
  };
  const kill = async (child) => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
  };
  try {
    const before = await shared();
    await admin.query(`CREATE SCHEMA ${namespace}`);
    created = true;
    const { marketDataMigrations } = await import(
      pathToFileURL(path.join(root, "packages/db/dist/index.js")).href
    );
    for (const migration of marketDataMigrations.slice(2, 7)) await pool.query(migration.sql);
    await publish();
    api = fork(__filename, ["--fixture"], {
      cwd: root,
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      windowsHide: true
    });
    let apiError = "";
    api.stderr.on("data", (chunk) => {
      apiError = (apiError + chunk).slice(-4000);
    });
    const ready = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("API startup timeout")), 15000);
      api.once("exit", () => {
        clearTimeout(timeout);
        reject(new Error(`Fixture exit: ${apiError}`));
      });
      api.on("message", (message) => {
        if (message.kind === "load-sample") samples.push(message);
        if (message.kind === "ready") {
          clearTimeout(timeout);
          resolve(message);
        }
      });
      api.send(config);
    });
    const k6Log = path.join(output, "sse-k6.log");
    await fs.writeFile(k6Log, "");
    k6 = spawn(
      path.resolve(process.env.K6_BINARY),
      ["run", "--quiet", "--no-usage-report", "scripts/load/sse.js"],
      {
        cwd: root,
        windowsHide: true,
        env: {
          ...process.env,
          SSE_BASE_URL: `http://127.0.0.1:${ready.port}`,
          SSE_JWT: ready.jwt,
          SSE_SUMMARY_PATH: path.join(output, "sse-k6-summary.json"),
          K6_ENABLE_COMMUNITY_EXTENSIONS: "true"
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    const k6Done = new Promise((resolve, reject) => {
      k6.once("error", reject);
      k6.once("exit", (code) => resolve(code));
    });
    k6.stdout.on("data", (chunk) => {
      void fs.appendFile(k6Log, chunk);
    });
    k6.stderr.on("data", (chunk) => {
      void fs.appendFile(k6Log, chunk);
    });
    timer = setInterval(() => {
      if (publishing) return;
      publishing = true;
      void publish()
        .catch((error) => {
          publishError = error;
        })
        .finally(() => {
          publishing = false;
        });
    }, 250);
    progress = setInterval(() => {
      const latest = samples.at(-1);
      console.log(
        JSON.stringify({
          kind: "sse_load_progress",
          connections: latest ? latest.market + latest.account : 0,
          tradesPublished: tradeId
        })
      );
    }, 30000);
    const deadline = Date.now() + 180000;
    let steadyStart;
    while (Date.now() < deadline && !steadyStart) {
      if (publishError) throw publishError;
      if (k6.exitCode !== null || k6.signalCode !== null)
        throw new Error(`k6 exited before steady state: ${k6.exitCode}`);
      if (samples.at(-1)?.market + samples.at(-1)?.account === 500)
        steadyStart = samples.at(-1).time;
      else await sleep(250);
    }
    assert.ok(steadyStart, "500 concurrent connections never reached");
    while (Date.now() - steadyStart < 60000) {
      if (publishError) throw publishError;
      const latest = samples.at(-1);
      assert.equal(latest.market + latest.account, 500, "Connection lost during steady state");
      await sleep(250);
    }
    const heldUntil = Date.now();
    clearInterval(timer);
    timer = undefined;
    while (publishing) await sleep(10);
    await publish(true);
    const exitCode = await Promise.race([
      k6Done,
      sleep(20000).then(() => {
        throw new Error("k6 did not finish after completion event");
      })
    ]);
    assert.equal(exitCode, 0, "k6 thresholds failed; inspect sse-k6-summary.json / sse-k6.log");
    await sleep(1500);
    assert.equal(
      samples.at(-1).market + samples.at(-1).account,
      0,
      "SSE sockets must close after load"
    );
    const summary = JSON.parse(await fs.readFile(path.join(output, "sse-k6-summary.json"), "utf8"));
    assert.equal(summary.metrics.dashboard_sse_ready.values.count, 500);
    assert.equal(summary.metrics.dashboard_sse_completed.values.count, 500);
    assert.equal(samples.at(-1).opened, 500, "No reconnects/replacement sockets allowed");
    assert.equal(samples.at(-1).closed, 500, "Every accepted connection must close");
    assert.deepEqual(await shared(), before, "Shared safety state changed");
    const steady = samples.filter(
      (sample) => sample.time >= steadyStart && sample.market + sample.account === 500
    );
    const report = {
      passed: true,
      tool: "Grafana k6 + xk6-sse",
      isolated: true,
      apiInstances: 1,
      connections: 500,
      marketConnections: steady[0].market,
      accountConnections: steady[0].account,
      rateLimitUnchanged: "300/min/IP; two cohorts of 250 separated by 61s",
      steadyStateMs: heldUntil - steadyStart,
      sampledSteadySpanMs: steady.at(-1).time - steady[0].time,
      publishedTrades: tradeId,
      workload:
        "target 20 trades/s, depth + 15m candle + account DB change each second; actual counts recorded",
      latencyScope: "fixture event generation to k6 SSE receipt, no browser/exchange",
      deliveryMs: summary.metrics.dashboard_market_delivery_ms.values,
      peakRssMiB: Math.max(...samples.map((sample) => sample.rss)) / 1048576,
      peakHeapMiB: Math.max(...samples.map((sample) => sample.heapUsed)) / 1048576,
      peakCpuPercent: Math.max(...steady.map((sample) => sample.cpuPercent)),
      peakLoopP95Ms: Math.max(...steady.map((sample) => sample.loopP95Ms)),
      allClosed: true,
      sharedUnchanged: true,
      samples
    };
    await fs.writeFile(path.join(output, "sse-load.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, samples: samples.length }));
  } catch (error) {
    await fs.writeFile(
      path.join(output, "sse-load-failure.json"),
      JSON.stringify({ error: error.message, samples }, null, 2)
    );
    throw error;
  } finally {
    clearInterval(timer);
    clearInterval(progress);
    while (publishing) await sleep(10);
    await kill(k6);
    await kill(api);
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", `${namespace}:*`, "COUNT", 100);
      cursor = next;
      assert.ok(keys.every((key) => key.startsWith(`${namespace}:`)));
      if (keys.length) await redis.del(...keys);
    } while (cursor !== "0");
    redis.disconnect();
    await pool.end();
    if (created) {
      assert.match(namespace, /^sse_load_[a-f0-9]{32}$/);
      await admin.query(`DROP SCHEMA ${namespace} CASCADE`);
    }
    await admin.end();
  }
}
if (process.argv.includes("--fixture")) {
  const { fixture } = require("../apps/web/scripts/verify-recovery.cjs");
  process.once("message", (config) =>
    fixture(config).catch((error) => {
      console.error(error);
      process.exit(1);
    })
  );
} else
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
