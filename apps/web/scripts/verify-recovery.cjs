/* global __dirname, __filename, setTimeout, clearTimeout, setInterval, clearInterval, window, MutationObserver, requestAnimationFrame, URL, innerWidth */
const assert = require("node:assert/strict");
const { Buffer } = require("node:buffer");
const { randomUUID, randomBytes } = require("node:crypto");
const { fork } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const net = require("node:net");

const root = path.resolve(__dirname, "../../..");
const load = (file) => import(pathToFileURL(path.join(root, file)).href);
const { Pool } = require(path.join(root, "apps/api/node_modules/pg"));
const Redis = require(path.join(root, "apps/api/node_modules/ioredis"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fixture(config) {
  const { z } = require(path.join(root, "apps/api/node_modules/zod"));
  const Fastify = require(path.join(root, "apps/api/node_modules/fastify"));
  const { configureGateway } = await load("apps/api/dist/app/gateway.js");
  const { registerApiAuth } = await load("apps/api/dist/app/auth.js");
  const { registerSessions } = await load("apps/api/dist/app/session.js");
  const { registerStreams } = await load("apps/api/dist/features/streams/streams.js");
  const { createStreamSource, encodeCursor } = await load(
    "apps/api/dist/features/streams/stream-source.js"
  );
  const { registerTradingState } = await load(
    "apps/api/dist/features/trading-state/trading-state.js"
  );
  const { createPortfolioReader } = await load("apps/api/dist/features/account/portfolio.js");
  const { registerAccountSummaryRoutes } = await load(
    "apps/api/dist/features/account/account-summary.js"
  );
  const { createSystemHealthReader } = await load("apps/api/dist/features/health/system-health.js");
  const pool = new Pool({
    connectionString: process.env.API_TEST_DATABASE_URL,
    options: `-c search_path=${config.namespace}`,
    connectionTimeoutMillis: 2000
  });
  const redis = new Redis(process.env.API_TEST_REDIS_URL, {
    connectTimeout: 2000,
    commandTimeout: 2000,
    maxRetriesPerRequest: 1
  });
  const api = Fastify();
  await configureGateway(api, process.env.API_TEST_REDIS_URL, {
    namespace: `${config.namespace}:rate:`,
    maxRequests: 300
  });
  registerApiAuth(api, config);
  await registerSessions(api, config);
  registerTradingState(api, pool);
  const portfolio = createPortfolioReader(
    pool,
    {
      metadata: async () => [],
      mark: async () => {
        throw new Error("No exchange access");
      }
    },
    "testnet"
  );
  registerAccountSummaryRoutes(api, pool, portfolio);
  const fixtureHealth = async () => ({
    checkedAt: Date.now(),
    redis: "available",
    database: "available",
    streams: []
  });
  const health = config.loadTest
    ? createSystemHealthReader({
        command: (args) =>
          redis.call(
            ...(args[0] === "PING"
              ? args
              : [
                  args[0],
                  ...args
                    .slice(1)
                    .map((arg) =>
                      arg.startsWith("market.") || arg === "signals"
                        ? `${config.namespace}:${arg}`
                        : arg
                    )
                ])
          ),
        database: () => pool.query("SELECT 1")
      })
    : fixtureHealth;
  api.get("/api/system/health", health);
  const source = createStreamSource(process.env.API_TEST_REDIS_URL, pool, {
    namespace: config.namespace,
    marketPrefix: `${config.namespace}:`,
    portfolio
  });
  // Only public bootstrap/dependency health are fixtures. Auth, Redis decoding, SSE and account DB reads are real.
  api.get(
    "/api/market/snapshot",
    {
      schema: {
        querystring: z.object({
          symbol: z.literal("BTCUSDT"),
          interval: z.enum(["1m", "5m", "15m", "1h"])
        })
      }
    },
    async (request) => {
      const interval = request.query.interval || "15m";
      const topic = { kind: "market", symbol: "BTCUSDT", interval };
      const histories = await Promise.all(
        [`market.trade.BTCUSDT`, `market.kline.BTCUSDT.${interval}`, `market.book.BTCUSDT`].map(
          (key) => redis.xrevrange(`${config.namespace}:${key}`, "+", "-", "COUNT", 8)
        )
      );
      return {
        symbol: topic.symbol,
        interval,
        checkedAt: Date.now(),
        cursor: encodeCursor(
          topic,
          histories.map((rows) => rows[0]?.[0] || "0-0")
        ),
        book: {
          symbol: topic.symbol,
          depthLimit: 5,
          bids: [{ price: "80000", quantity: "1" }],
          asks: [{ price: "80001", quantity: "1" }],
          lastUpdateId: 1,
          eventTimeMs: Date.now(),
          complete: false
        },
        trades: histories[0]
          .slice()
          .reverse()
          .map((row) => JSON.parse(row[1][1]).trade),
        candles: []
      };
    }
  );
  api.addHook("onRequest", async (request) => {
    if (request.url.startsWith("/api/stream/"))
      process.send?.({
        kind: "stream-request",
        url: request.url,
        lastEventId: request.headers["last-event-id"] || null
      });
  });
  if (config.loadTest) {
    const { monitorEventLoopDelay } = require("node:perf_hooks");
    const histogram = monitorEventLoopDelay({ resolution: 20 });
    histogram.enable();
    const counts = { market: 0, account: 0, opened: 0, closed: 0, peak: 0 };
    let cpu = process.cpuUsage(),
      sampledAt = Date.now();
    api.addHook("onRequest", async (request, reply) => {
      if (!request.url.startsWith("/api/stream/")) return;
      const kind = request.url.startsWith("/api/stream/market") ? "market" : "account";
      let counted = false;
      const original = reply.raw.writeHead;
      reply.raw.writeHead = function (...args) {
        if (args[0] === 200 && !counted) {
          counted = true;
          counts[kind]++;
          counts.opened++;
          counts.peak = Math.max(counts.peak, counts.market + counts.account);
        }
        return original.apply(this, args);
      };
      reply.raw.once("close", () => {
        if (counted) {
          counts[kind]--;
          counts.closed++;
        }
      });
    });
    const timer = setInterval(() => {
      const now = Date.now(),
        usage = process.cpuUsage(cpu);
      process.send?.({
        kind: "load-sample",
        time: now,
        ...counts,
        ...process.memoryUsage(),
        cpuPercent: (usage.user + usage.system) / ((now - sampledAt) * 10),
        loopP95Ms: histogram.percentile(95) / 1e6,
        loopMaxMs: histogram.max / 1e6
      });
      cpu = process.cpuUsage();
      sampledAt = now;
      histogram.reset();
    }, 1000);
    api.addHook("onClose", async () => {
      clearInterval(timer);
      histogram.disable();
    });
  }
  registerStreams(api, source, { health });
  await api.listen({ host: "127.0.0.1", port: config.port });
  process.send?.({
    kind: "ready",
    port: api.server.address().port,
    ...(config.loadTest
      ? { jwt: api.jwt.sign({ role: "viewer", sub: "viewer-token" }, { expiresIn: "10m" }) }
      : {})
  });
}

async function main() {
  assert.ok(
    process.env.API_TEST_DATABASE_URL && process.env.API_TEST_REDIS_URL,
    "Explicit test infrastructure URLs required"
  );
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const { preview } = await load("apps/web/node_modules/vite/dist/node/index.js");
  const { marketDataMigrations } = await load("packages/db/dist/index.js");
  const namespace = `recovery_e2e_${randomUUID().replaceAll("-", "")}`;
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
  const output = path.join(root, "logs/verification/phase-4-2");
  const config = {
    namespace,
    viewerToken: randomBytes(32).toString("hex"),
    operatorToken: randomBytes(32).toString("hex"),
    jwtSecret: randomBytes(32).toString("hex"),
    allowedOrigins: []
  };
  let child,
    vite,
    browser,
    page,
    created = false,
    tradeId = 0;
  const errors = [],
    requests = [],
    streamRequests = [],
    samples = [];
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
  async function start() {
    child = fork(__filename, ["--fixture"], {
      cwd: root,
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      windowsHide: true
    });
    const running = child;
    let stderr = "";
    running.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Fixture startup timeout")), 15000);
      running.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(`Fixture exited: ${stderr}`));
      });
      running.on("message", (message) => {
        if (message.kind === "stream-request") streamRequests.push(message);
        if (message.kind === "ready") {
          clearTimeout(timer);
          resolve();
        }
      });
      running.send(config);
    });
  }
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
  }
  async function publish() {
    const id = String(++tradeId);
    const price = String(81000 + tradeId);
    const occurredAtMs = Date.now();
    const event = {
      kind: "trade",
      symbol: "BTCUSDT",
      eventId: `fixture-${id}`,
      occurredAtMs,
      trade: {
        symbol: "BTCUSDT",
        tradeId: id,
        price,
        quantity: "0.0002",
        eventTimeMs: occurredAtMs,
        isBuyerMaker: false
      }
    };
    const cursor = await redis.xadd(
      `${namespace}:market.trade.BTCUSDT`,
      "MAXLEN",
      "=",
      2000,
      "*",
      "payload",
      JSON.stringify(event)
    );
    return {
      id,
      price,
      occurredAtMs,
      committedAtMs: Date.now(),
      cursor,
      text: Number(price).toLocaleString("en-US", { minimumFractionDigits: 2 })
    };
  }
  async function measured(viewport) {
    const expected = Number(81000 + tradeId + 1).toLocaleString("en-US", {
      minimumFractionDigits: 2
    });
    await page.evaluate((text) => {
      window.__paint = null;
      const panel = document.querySelector(".workspace-market aside");
      const observer = new MutationObserver(() => {
        if (![...panel.querySelectorAll("td")].some((node) => node.textContent === text)) return;
        observer.disconnect();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            window.__paint = Date.now();
          })
        );
      });
      observer.observe(panel, { subtree: true, childList: true, characterData: true });
    }, expected);
    const event = await publish();
    await page.waitForFunction(() => window.__paint !== null, undefined, { timeout: 5000 });
    const paintedAtMs = await page.evaluate(() => window.__paint);
    const sample = {
      viewport,
      tradeId: event.id,
      eventToPaintMs: paintedAtMs - event.occurredAtMs,
      redisCommitToPaintMs: paintedAtMs - event.committedAtMs
    };
    samples.push(sample);
    assert.ok(
      sample.eventToPaintMs >= 0 && sample.eventToPaintMs < 1000,
      `Event-to-paint budget exceeded: ${JSON.stringify(sample)}`
    );
    return event;
  }
  try {
    await fs.mkdir(output, { recursive: true });
    const before = await shared();
    await admin.query(`CREATE SCHEMA ${namespace}`);
    created = true;
    for (const migration of marketDataMigrations.slice(2, 7)) await pool.query(migration.sql);
    const portServer = net.createServer();
    await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
    config.port = portServer.address().port;
    await new Promise((resolve) => portServer.close(resolve));
    vite = await preview({
      root: path.join(root, "apps/web"),
      configFile: path.join(root, "apps/web/vite.config.ts"),
      preview: {
        host: "127.0.0.1",
        port: 5182,
        strictPort: false,
        proxy: { "/api": `http://127.0.0.1:${config.port}` }
      },
      logLevel: "silent"
    });
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    config.allowedOrigins.push(origin);
    await publish();
    await start();
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    let navigations = 0;
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame() && request.resourceType() === "document") navigations++;
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        requests.push({
          method: request.method(),
          path: new URL(request.url()).pathname,
          type: request.resourceType()
        });
    });
    await page.goto(`${origin}/#/market`);
    await page.getByLabel("Dashboard credential").fill(config.viewerToken);
    await page.getByRole("dialog").getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByText("Streaming", { exact: true }).waitFor({ timeout: 15000 });
    await sleep(600);
    const navigationCount = navigations;
    let lastApplied;
    for (let index = 0; index < 20; index++) lastApplied = await measured("desktop");
    const retainedSnapshots = requests.filter((r) => r.path === "/api/market/snapshot").length;
    const healthyReads = requests.filter(
      (r) => r.type !== "eventsource" && r.method === "GET"
    ).length;
    await sleep(1200);
    assert.equal(
      requests.filter((r) => r.type !== "eventsource" && r.method === "GET").length,
      healthyReads,
      "Healthy transport must not poll"
    );
    const outageAt = Date.now();
    await stop();
    await page.getByText("Reconnecting", { exact: true }).waitFor({ timeout: 55000 });
    const outageDetectionMs = Date.now() - outageAt;
    const offline = [await publish(), await publish(), await publish()];
    await pool.query(
      "UPDATE risk_control_state SET reason='account-recovered', updated_at=NOW() WHERE scope='global'"
    );
    const resumedRequestIndex = streamRequests.length;
    const restartAt = Date.now();
    await start();
    await page.getByText("Streaming", { exact: true }).waitFor({ timeout: 20000 });
    for (const event of offline)
      await page
        .locator(".workspace-market aside")
        .getByText(event.text, { exact: true })
        .waitFor({ timeout: 5000 });
    await page.getByRole("link", { name: "Risk", exact: true }).click();
    await page.getByText("account-recovered", { exact: true }).waitFor({ timeout: 5000 });
    await page.getByRole("link", { name: "Market", exact: true }).click();
    await page.locator(".workspace-market aside").waitFor();
    const recoveryMs = Date.now() - restartAt;
    const resumed = streamRequests.slice(resumedRequestIndex);
    assert.equal(
      requests.filter((r) => r.path === "/api/market/snapshot").length,
      retainedSnapshots,
      "Retained cursor recovery must replay without another bootstrap"
    );
    const resumedMarket = resumed.find((r) => r.url.startsWith("/api/stream/market"));
    const resumeCursor = new URL(resumedMarket.url, origin).searchParams.get("cursor");
    assert.equal(
      JSON.parse(Buffer.from(resumeCursor.slice(3), "base64url").toString()).ids[0],
      lastApplied.cursor,
      "Resume from the last painted/applied trade, not an unacknowledged batch"
    );
    assert.ok(
      resumed.some(
        (r) =>
          r.url.startsWith("/api/stream/market") &&
          new URL(r.url, origin).searchParams.get("cursor")
      ),
      "Market recovery must carry a resume cursor"
    );
    assert.ok(
      resumed.some((r) => r.url.startsWith("/api/stream/account")),
      "Account SSE must recover too"
    );
    for (let index = 0; index < 10; index++) await measured("desktop-after-restart");
    await page.screenshot({ path: path.join(output, "recovery-desktop.png"), fullPage: true });
    // Remove retained history during a second outage: the browser must rebootstrap on 409.
    const snapshotsBefore = requests.filter((r) => r.path === "/api/market/snapshot").length;
    await stop();
    await page.getByText("Reconnecting", { exact: true }).waitFor({ timeout: 55000 });
    await redis.del(
      `${namespace}:market.trade.BTCUSDT`,
      `${namespace}:account-events`,
      `${namespace}:account-digest`
    );
    const replacement = await publish();
    await start();
    await page
      .locator(".workspace-market aside")
      .getByText(replacement.text, { exact: true })
      .waitFor({ timeout: 25000 });
    await page.getByText("Streaming", { exact: true }).waitFor({ timeout: 15000 });
    assert.ok(
      requests.filter((r) => r.path === "/api/market/snapshot").length > snapshotsBefore,
      "Trimmed cursor must rebootstrap"
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".workspace-market aside").scrollIntoViewIfNeeded();
    for (let index = 0; index < 20; index++) await measured("mobile");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, "recovery-mobile.png"), fullPage: true });
    assert.equal(navigations, navigationCount, "Recovery must not reload the page");
    assert.deepEqual(errors, []);
    assert.ok(
      requests
        .filter((r) => r.method !== "GET")
        .every((r) => r.method === "POST" && r.path === "/api/auth/login"),
      "No trading/control writes allowed"
    );
    assert.deepEqual(await shared(), before, "Shared safety state must remain unchanged");
    const values = samples.map((s) => s.eventToPaintMs).sort((a, b) => a - b);
    const report = {
      passed: true,
      isolated: true,
      restart: "API subprocess killed/recreated on same port",
      marketBootstrap: "synthetic",
      marketTransport: "real Redis decoding + authenticated SSE + actual UI",
      latencyScope:
        "controlled event generation through Redis/API to DOM plus two animation frames; excludes exchange/network ingestion",
      samples,
      p50Ms: values[Math.floor(values.length * 0.5)],
      p95Ms: values[Math.ceil(values.length * 0.95) - 1],
      maxMs: values.at(-1),
      recoveryMs,
      outageDetectionMs,
      missedTradesReplayed: offline.length,
      accountRecovered: true,
      trimmedCursorResync: true,
      noManualReload: true,
      healthyNoPolling: true,
      sharedUnchanged: true,
      errors
    };
    await fs.writeFile(path.join(output, "recovery-latency.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, samples: samples.length }));
  } catch (error) {
    await fs
      .writeFile(
        path.join(output, "recovery-failure.json"),
        JSON.stringify({ error: error.message, samples, errors }, null, 2)
      )
      .catch(() => {});
    if (page && !page.isClosed())
      await page.screenshot({ path: path.join(output, "recovery-failure.png"), fullPage: true });
    throw error;
  } finally {
    await browser?.close();
    if (vite) await new Promise((resolve) => vite.httpServer.close(resolve));
    await stop();
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
      assert.match(namespace, /^recovery_e2e_[a-f0-9]{32}$/);
      await admin.query(`DROP SCHEMA ${namespace} CASCADE`);
    }
    await admin.end();
  }
}

if (require.main === module && process.argv.includes("--fixture")) {
  process.once("message", (config) =>
    fixture(config).catch((error) => {
      console.error(error);
      process.exit(1);
    })
  );
} else if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
module.exports = { fixture };
