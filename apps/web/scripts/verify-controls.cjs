/* global __dirname, URL, localStorage, sessionStorage */
const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");

async function main() {
  assert.ok(
    process.env.API_TEST_DATABASE_URL && process.env.API_TEST_REDIS_URL,
    "Explicit test infrastructure URLs required"
  );
  const root = path.resolve(__dirname, "../../..");
  const load = (file) => import(pathToFileURL(path.join(root, file)).href);
  const { Pool } = require(path.join(root, "apps/api/node_modules/pg"));
  const Redis = require(path.join(root, "apps/api/node_modules/ioredis"));
  const Fastify = require(path.join(root, "apps/api/node_modules/fastify"));
  const { z } = require(path.join(root, "apps/api/node_modules/zod"));
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const { createServer } = await load("apps/web/node_modules/vite/dist/node/index.js");
  const { marketDataMigrations } = await load("packages/db/dist/index.js");
  const { configureGateway } = await load("apps/api/dist/app/gateway.js");
  const { registerApiAuth } = await load("apps/api/dist/app/auth.js");
  const { registerSessions } = await load("apps/api/dist/app/session.js");
  const { registerStrategyControlRoutes } = await load(
    "apps/api/dist/features/strategies/strategy-control.js"
  );
  const { registerRiskControlRoutes } = await load("apps/api/dist/features/risk/risk-control.js");
  const { registerTradingState } = await load(
    "apps/api/dist/features/trading-state/trading-state.js"
  );
  const { createStreamSource, encodeCursor } = await load(
    "apps/api/dist/features/streams/stream-source.js"
  );
  const { registerStreams } = await load("apps/api/dist/features/streams/streams.js");
  const { createPortfolioReader } = await load("apps/api/dist/features/account/portfolio.js");
  const { registerAccountSummaryRoutes } = await load(
    "apps/api/dist/features/account/account-summary.js"
  );
  const namespace = `control_e2e_${randomUUID().replaceAll("-", "")}`;
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
  const api = Fastify();
  const config = {
    viewerToken: randomBytes(32).toString("hex"),
    operatorToken: randomBytes(32).toString("hex"),
    jwtSecret: randomBytes(32).toString("hex"),
    allowedOrigins: []
  };
  let page,
    vite,
    browser,
    source,
    created = false;
  const errors = [],
    writes = [];
  const shared = async () => {
    const state = (
      await admin.query(`SELECT
      (SELECT count(*)::int FROM public.orders) AS orders,
      (SELECT count(*)::int FROM public.order_fills) AS fills,
      (SELECT count(*)::int FROM public.audit_log) AS audits,
      (SELECT count(*)::int FROM public.risk_events) AS events,
      (SELECT jsonb_agg(s ORDER BY s.scope) FROM public.risk_control_state s) AS risk,
      (SELECT jsonb_agg(s ORDER BY s.strategy_id) FROM public.strategy_control_state s) AS strategies`)
    ).rows[0];
    return { ...state, redisKill: await redis.get("meridian:risk:kill-switch") };
  };
  try {
    const before = await shared();
    await admin.query(`CREATE SCHEMA ${namespace}`);
    created = true;
    for (const migration of marketDataMigrations.slice(2, 7)) await pool.query(migration.sql);
    await pool.query(
      "INSERT INTO strategy_control_state(strategy_id,paused,reason) VALUES ('ema',false,'test initial state')"
    );
    await pool.query(`CREATE FUNCTION reject_browser_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.details->>'reason'='reject-browser-audit' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_browser_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_browser_audit()`);
    await configureGateway(api, process.env.API_TEST_REDIS_URL, {
      namespace: `${namespace}:rate:`,
      maxRequests: 300
    });
    registerApiAuth(api, config);
    await registerSessions(api, config);
    registerStrategyControlRoutes(api, pool);
    registerRiskControlRoutes(api, pool, {
      sendCommand: async (args) => {
        assert.deepEqual(args, ["SET", "meridian:risk:kill-switch", "1"]);
        return redis.set(`${namespace}:kill-switch`, "1");
      }
    });
    registerTradingState(api, pool);
    const portfolio = createPortfolioReader(
      pool,
      {
        metadata: async () => [],
        mark: async () => {
          throw new Error("No exchange access in control test");
        }
      },
      "testnet"
    );
    registerAccountSummaryRoutes(api, pool, portfolio);
    api.get("/api/system/health", async () => ({
      checkedAt: Date.now(),
      redis: "available",
      database: "available",
      streams: []
    }));
    // Synthetic public market bootstrap only; controls/account SSE use actual DB and Redis.
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
        const topic = {
          kind: "market",
          symbol: "BTCUSDT",
          interval: request.query.interval || "15m"
        };
        return {
          symbol: topic.symbol,
          interval: topic.interval,
          checkedAt: Date.now(),
          cursor: encodeCursor(topic, ["0-0", "0-0", "0-0"]),
          book: {
            symbol: "BTCUSDT",
            depthLimit: 5,
            bids: [{ price: "100", quantity: "1" }],
            asks: [{ price: "101", quantity: "1" }],
            lastUpdateId: 1,
            eventTimeMs: Date.now(),
            complete: false
          },
          trades: [],
          candles: []
        };
      }
    );
    source = createStreamSource(process.env.API_TEST_REDIS_URL, pool, {
      namespace,
      marketPrefix: `${namespace}:`,
      portfolio
    });
    registerStreams(api, {
      open: (topic, cursor) =>
        topic.kind === "account"
          ? source.open(topic, cursor)
          : Promise.resolve(cursor || encodeCursor(topic, ["0-0", "0-0", "0-0"])),
      read: (topic, cursor) =>
        topic.kind === "account"
          ? source.read(topic, cursor)
          : Promise.resolve({ cursor, events: [] }),
      close: () => source.close()
    });
    await api.listen({ host: "127.0.0.1", port: 0 });
    vite = await createServer({
      root: path.join(root, "apps/web"),
      configFile: path.join(root, "apps/web/vite.config.ts"),
      server: {
        host: "127.0.0.1",
        port: 5180,
        strictPort: false,
        proxy: { "/api": api.listeningOrigin }
      },
      logLevel: "error"
    });
    await vite.listen();
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    config.allowedOrigins.push(origin);
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      const endpoint = new URL(request.url()).pathname;
      if (
        request.method() === "POST" &&
        (endpoint.includes("/strategies/") || endpoint.includes("/kill-switch/"))
      )
        writes.push(endpoint);
    });
    const login = async (token) => {
      await page.getByLabel("Dashboard credential").fill(token);
      await page.getByRole("dialog").getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.getByRole("heading", { name: "Strategies", exact: true }).waitFor();
    };
    const auditCount = async () =>
      (await pool.query("SELECT count(*)::int AS count FROM audit_log")).rows[0].count;
    const paused = async () =>
      (await pool.query("SELECT paused FROM strategy_control_state WHERE strategy_id='ema'"))
        .rows[0].paused;
    const engaged = async () =>
      (await pool.query("SELECT engaged FROM risk_control_state WHERE scope='global'")).rows[0]
        .engaged;
    const control = async (name, reason, confirmation) => {
      await page.getByRole("button", { name, exact: true }).click();
      await page.getByLabel("Reason", { exact: true }).fill(reason);
      if (name === "Request resume") await page.getByLabel("Type RESUME to confirm").fill("RESUME");
      if (name === "Engage kill switch") await page.getByLabel("Type STOP to confirm").fill("STOP");
      const response = page.waitForResponse(
        (r) => r.request().method() === "POST" && !new URL(r.url()).pathname.includes("/auth/")
      );
      await page
        .getByRole("dialog")
        .getByRole("button", { name: confirmation, exact: true })
        .click();
      return response;
    };
    await page.goto(`${origin}/#/strategies`);
    await login(config.viewerToken);
    assert.equal(await page.getByRole("button", { name: "Pause", exact: true }).isDisabled(), true);
    await page.getByRole("link", { name: "Risk", exact: true }).click();
    assert.equal(
      await page.getByRole("button", { name: "Engage kill switch", exact: true }).isDisabled(),
      true
    );
    await page.getByRole("link", { name: "Strategies", exact: true }).click();
    for (const endpoint of [
      "/api/strategies/ema/pause",
      "/api/strategies/ema/resume",
      "/api/risk/kill-switch/engage"
    ]) {
      const denied = await context.request.post(origin + endpoint, {
        headers: { Origin: origin },
        data: {
          reason: "denied",
          ...(endpoint.endsWith("resume") ? { confirm: "RESUME_STRATEGY" } : {})
        }
      });
      assert.equal(denied.status(), 403);
    }
    assert.equal(await auditCount(), 0);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await login(config.operatorToken);
    await page.waitForFunction(
      () => document.querySelector(".strategy-actions button")?.disabled === false
    );
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(writes.length, 0);
    assert.equal(await auditCount(), 0);
    assert.equal((await control("Pause", "browser pause", "Confirm pause")).status(), 200);
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Request resume", exact: true }).waitFor();
    assert.equal(await paused(), true);
    await page.getByRole("button", { name: "Request resume", exact: true }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await paused(), true);
    assert.equal(await auditCount(), 1);
    assert.equal(writes.length, 1);
    assert.equal(
      (await control("Request resume", "browser resume", "Confirm resume")).status(),
      200
    );
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
    assert.equal(await paused(), false);
    assert.equal(await engaged(), true, "Resume must not clear global kill");
    assert.equal((await control("Pause", "reject-browser-audit", "Confirm pause")).status(), 503);
    await page
      .getByText("Action failed. Check confirmation, reason and account connection.", {
        exact: true
      })
      .waitFor();
    assert.equal(await paused(), false);
    assert.equal(await auditCount(), 2);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await pool.query(
      "UPDATE risk_control_state SET engaged=false,reason='isolated kill fixture' WHERE scope='global'"
    );
    await page.getByRole("link", { name: "Risk", exact: true }).click();
    await page.getByText("isolated kill fixture", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Engage kill switch", exact: true }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await engaged(), false);
    assert.equal(await auditCount(), 2);
    assert.equal(await redis.get(`${namespace}:kill-switch`), null);
    assert.equal(
      (await control("Engage kill switch", "browser emergency", "Engage kill switch")).status(),
      200
    );
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByText("browser emergency", { exact: true }).first().waitFor();
    assert.equal(await engaged(), true);
    assert.equal(await redis.get(`${namespace}:kill-switch`), "1");
    const audits = (await pool.query("SELECT actor,action,details FROM audit_log ORDER BY id"))
      .rows;
    assert.deepEqual(
      audits.map((r) => [r.actor, r.action, r.details.reason]),
      [
        ["operator-token", "api-strategy-paused", "browser pause"],
        ["operator-token", "api-strategy-resumed", "browser resume"],
        ["operator-token", "api-kill-switch-engaged", "browser emergency"]
      ]
    );
    assert.equal(
      (await pool.query("SELECT count(*)::int AS count FROM risk_events")).rows[0].count,
      3
    );
    await fs.mkdir(path.join(root, "logs/verification/phase-4-2"), { recursive: true });
    await page.screenshot({
      path: path.join(root, "logs/verification/phase-4-2/controls-isolated.png"),
      fullPage: true
    });
    await page.getByRole("link", { name: "Strategies", exact: true }).click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByLabel("Reason", { exact: true }).fill("expired attempt");
    const expired = api.jwt.sign({ role: "operator", sub: "operator-token", exp: 1 });
    await context.addCookies([
      {
        name: "meridian_session",
        value: expired,
        domain: "127.0.0.1",
        path: "/api",
        httpOnly: true,
        sameSite: "Strict"
      }
    ]);
    const expiryResponse = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/strategies/ema/pause" && r.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Confirm pause", exact: true }).click();
    assert.equal((await expiryResponse).status(), 401);
    await page.getByLabel("Dashboard credential").waitFor();
    assert.equal(await page.locator(".strategy-select").count(), 0);
    assert.equal(await auditCount(), 3);
    const short = api.jwt.sign({ role: "operator", sub: "operator-token" }, { expiresIn: 4 });
    await context.addCookies([
      {
        name: "meridian_session",
        value: short,
        domain: "127.0.0.1",
        path: "/api",
        httpOnly: true,
        sameSite: "Strict"
      }
    ]);
    await page.reload();
    await page.getByRole("heading", { name: "Strategies", exact: true }).waitFor();
    await page.getByLabel("Dashboard credential").waitFor({ timeout: 8000 });
    assert.equal(await page.locator(".strategy-select").count(), 0);
    assert.equal(await auditCount(), 3);
    assert.deepEqual(
      await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
      { local: 0, session: 0 }
    );
    assert.deepEqual(errors, []);
    const after = await shared();
    assert.deepEqual(after, before, "Shared application safety state must remain unchanged");
    const report = {
      isolated: true,
      marketBootstrap: "synthetic-public-fixture",
      realCookieAuth: true,
      accountUpdatesViaSSE: true,
      viewerDenied: 3,
      pauseResume: true,
      cancelNoWrite: true,
      failedAuditRollback: true,
      globalKillPreserved: true,
      expiry401AndTimer: true,
      audits: audits.length,
      riskEvents: 3,
      sharedUnchanged: true,
      controlRequests: writes.length,
      errors
    };
    await fs.writeFile(
      path.join(root, "logs/verification/phase-4-2/controls-isolated.json"),
      JSON.stringify(report, null, 2)
    );
    console.log(JSON.stringify(report));
  } catch (error) {
    if (page && !page.isClosed()) {
      await fs.mkdir(path.join(root, "logs/verification/phase-4-2"), { recursive: true });
      await page.screenshot({
        path: path.join(root, "logs/verification/phase-4-2/controls-failure.png"),
        fullPage: true
      });
      console.error(JSON.stringify({ ui: await page.locator("body").innerText(), errors }));
    }
    throw error;
  } finally {
    await browser?.close();
    await vite?.close();
    await api.close();
    if (source) await source.close();
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
      assert.match(namespace, /^control_e2e_[a-f0-9]{32}$/);
      await admin.query(`DROP SCHEMA ${namespace} CASCADE`);
    }
    await admin.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
