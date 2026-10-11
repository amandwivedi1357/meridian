/* global window, setTimeout, URL, innerWidth */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
async function main() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const output = path.resolve("logs/verification/phase-4-2");
  await fs.mkdir(output, { recursive: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", (e) => errors.push(e.message));
    if (process.env.TERMINAL_REAL_API === "1") {
      const writes = [];
      page.on("request", (r) => {
        if (r.url().includes("/api/") && r.method() !== "GET" && !r.url().endsWith("/auth/login"))
          writes.push(r.url());
      });
      await page.goto("http://127.0.0.1:5173/");
      const env = require("node:util").parseEnv(await fs.readFile(".env", "utf8"));
      if (env.API_VIEWER_TOKEN) {
        await page.getByLabel("Dashboard credential").fill(env.API_VIEWER_TOKEN);
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await page.getByRole("dialog").waitFor({ state: "hidden" });
      }
      await page.getByRole("link", { name: "Backtests", exact: true }).click();
      await page.locator(".simulation-disclosure summary").click();
      await page.getByRole("heading", { name: "Saved runs", exact: true }).waitFor();
      await page
        .getByRole("status")
        .filter({ hasText: "Loading runs" })
        .waitFor({ state: "hidden" });
      assert.equal(
        await page.getByRole("button", { name: "Run simulation", exact: true }).isDisabled(),
        true
      );
      await page.screenshot({
        path: path.join(output, "backtests-real-viewer.png"),
        fullPage: true
      });
      assert.deepEqual(writes, []);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ realViewer: "passed", readOnly: true }));
      return;
    }
    let role = "viewer",
      login = false,
      jobId = "",
      jobReads = 0,
      failSubmission = true,
      failedJob = false;
    const submitted = [],
      saved = ["run-one"];
    const uuid = "00000000-0000-4000-8000-000000000001";
    const run = (id) => ({
      runId: id,
      strategy: "ema",
      symbol: "BTCUSDT",
      interval: "15m",
      fromMs: String(Date.parse("2026-10-01")),
      toMs: String(Date.parse("2026-10-02")),
      createdAt: "2026-10-02T12:00:00Z",
      params: {
        initialEquity: "10000",
        quantity: "0.001",
        fastPeriod: 12,
        slowPeriod: 26,
        takerFeeRate: "0.001",
        slippageBps: "10"
      },
      metrics: {
        totalReturnPct: "1",
        maxDrawdownPct: "2",
        sharpeRatio: "1.2",
        winRatePct: "50",
        buyAndHoldReturnPct: "0.5",
        tradeCount: 4
      }
    });
    const equity = Array.from({ length: 4 }, (_, index) => ({
      index,
      tsMs: String(Date.parse("2026-10-01") + index * 900000),
      equity: ["10000", "10200", "9996", "10100"][index]
    }));
    const fills = Array.from({ length: 4 }, (_, index) => ({
      index,
      tsMs: String(Date.parse("2026-10-01") + index * 900000),
      symbol: "BTCUSDT",
      side: index % 2 ? "SELL" : "BUY",
      quantity: "0.001",
      price: "83000",
      fee: "0.083",
      feeAsset: "USDT"
    }));
    await page.addInitScript(() => {
      window.EventSource = class {
        constructor(url) {
          this.url = url;
        }
        addEventListener(type, fn) {
          if (type === "ready") setTimeout(() => fn({ lastEventId: "ready", data: "{}" }), 20);
        }
        close() {}
      };
    });
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      let data;
      if (url.pathname === "/api/system/health")
        data = { checkedAt: Date.now(), redis: "available", database: "available", streams: [] };
      else if (url.pathname === "/api/dashboard") data = { checkedAt: Date.now(), symbol: "BTCUSDT", source: "fixture", feed: "waiting", trades: [], redis: { available: true, count: 0, memoryBytes: 0 }, database: { available: true, count: 0, checkedAt: Date.now() }, recording: null };
      else if (url.pathname === "/api/auth/me")
        data = {
          principal: {
            role,
            actor: "fixture",
            ...(login ? { expiresAtMs: Date.now() + 900000 } : {})
          }
        };
      else if (url.pathname === "/api/auth/login") {
        login = true;
        role = "operator";
        data = { role };
      } else if (url.pathname === "/api/trading/state")
        data = {
          checkedAt: Date.now(),
          orders: [],
          fills: [],
          strategies: [],
          riskEvents: [],
          riskControl: null
        };
      else if (url.pathname === "/api/account/summary")
        data = {
          portfolio: {
            checkedAt: Date.now(),
            equity: null,
            equityReason: "unavailable",
            positions: [],
            totals: []
          }
        };
      else if (url.pathname === "/api/market/snapshot")
        data = {
          symbol: "BTCUSDT",
          interval: url.searchParams.get("interval"),
          cursor: "bootstrap",
          checkedAt: Date.now(),
          book: {
            bids: [{ price: "100", quantity: "1" }],
            asks: [{ price: "101", quantity: "1" }],
            lastUpdateId: 1,
            eventTimeMs: Date.now(),
            complete: false
          },
          trades: [],
          candles: []
        };
      else if (url.pathname === "/api/backtests") data = { runs: saved.map(run) };
      else if (url.pathname === "/api/backtests/jobs" && req.method() === "POST") {
        const request = JSON.parse(req.postData());
        submitted.push(request);
        assert.equal(request.symbol, "BTCUSDT");
        if (failSubmission) {
          failSubmission = false;
          await route.abort("failed");
          return;
        }
        jobId = failedJob ? "00000000-0000-4000-8000-000000000002" : uuid;
        jobReads = 0;
        data = { job: { jobId, state: "queued", request, runId: null, error: null } };
      } else if (url.pathname === `/api/backtests/jobs/${jobId}`) {
        jobReads++;
        const state = jobReads < 2 ? "running" : failedJob ? "failed" : "succeeded";
        if (state === "succeeded" && !saved.includes("run-two")) saved.unshift("run-two");
        data = {
          job: {
            jobId,
            state,
            request: submitted.at(-1),
            runId: state === "succeeded" ? "run-two" : null,
            error: state === "failed" ? "market_history_incomplete" : null
          }
        };
      } else if (url.pathname.startsWith("/api/backtests/")) {
        const parts = url.pathname.split("/"),
          id = decodeURIComponent(parts[3]);
        if (parts[4] === "equity" || parts[4] === "fills") {
          const rows = parts[4] === "equity" ? equity : fills,
            after = Number(url.searchParams.get("after"));
          data = {
            items: rows.filter((r) => r.index > after).slice(0, 2),
            nextCursor: after < 0 ? 1 : null
          };
        } else data = { run: run(id) };
      } else throw new Error(`Unexpected route ${url.pathname}`);
      await route.fulfill({
        status: req.method() === "POST" && url.pathname.includes("jobs") ? 202 : 200,
        contentType: "application/json",
        body: JSON.stringify(data)
      });
    });
    await page.goto("http://127.0.0.1:5173/");
    await page.getByRole("link", { name: "Backtests", exact: true }).click();
    await page.locator(".simulation-disclosure summary").click();
    await page.getByText("4 points", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Run simulation", exact: true }).isDisabled(),
      true
    );
    await page.getByRole("button", { name: "Load more fills", exact: true }).click();
    await page.getByText("4 loaded", { exact: true }).waitFor();
    const canvases = await page.locator(".backtest-result-chart").evaluateAll((nodes) =>
      nodes.map((node) => {
        const c = node.querySelector("canvas");
        return { width: c.width, height: c.height };
      })
    );
    assert.ok(canvases.every((c) => c.width > 100 && c.height > 100));
    await page.screenshot({
      path: path.join(output, "backtests-results-desktop.png"),
      fullPage: true
    });
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Dashboard credential").fill("v".repeat(32));
    await page.getByRole("dialog").getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByLabel("From (UTC)", { exact: true }).fill("2026-10-02");
    await page.getByLabel("To (UTC, exclusive)", { exact: true }).fill("2026-10-01");
    await page.getByRole("button", { name: "Run simulation", exact: true }).click();
    await page.getByText("End date must follow start date").waitFor();
    assert.equal(submitted.length, 0);
    await page.getByLabel("From (UTC)", { exact: true }).fill("2026-10-01");
    await page.getByLabel("To (UTC, exclusive)", { exact: true }).fill("2026-10-02");
    await page.getByRole("button", { name: "Run simulation", exact: true }).click();
    await page.getByRole("button", { name: "Retry submission", exact: true }).waitFor();
    await page.getByRole("button", { name: "Retry submission", exact: true }).click();
    await page.getByText("succeeded", { exact: true }).waitFor({ timeout: 10000 });
    assert.equal(submitted[0].requestId, submitted[1].requestId);
    await page.getByText("run-two", { exact: true }).first().waitFor();
    const reads = jobReads;
    await page.waitForTimeout(2500);
    assert.equal(jobReads, reads, "Terminal jobs must stop polling");
    failedJob = true;
    await page.getByLabel("To (UTC, exclusive)", { exact: true }).fill("2026-10-03");
    await page.getByRole("button", { name: "Run simulation", exact: true }).click();
    await page
      .getByText("Stored candle history is incomplete for this range", { exact: true })
      .waitFor({ timeout: 10000 });
    assert.notEqual(submitted[1].requestId, submitted[2].requestId);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({
      path: path.join(output, "backtests-results-mobile.png"),
      fullPage: true
    });
    await page.getByRole("link", { name: "Market", exact: true }).click();
    await page.getByRole("group", { name: "Candle interval" }).waitFor();
    await page.getByRole("link", { name: "Backtests", exact: true }).click();
    await page.getByText("failed", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        mockedBrowser: "passed",
        submitted: submitted.length,
        jobReads,
        pagination: true,
        idempotentRetry: true,
        terminalPollingStopped: true,
        errors
      })
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
