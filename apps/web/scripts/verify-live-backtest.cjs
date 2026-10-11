/* global URL, innerWidth */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { parseEnv } = require("node:util");

async function main() {
  const env = parseEnv(await fs.readFile(".env", "utf8"));
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const output = path.resolve("logs/verification/phase-4-2");
  await fs.mkdir(output, { recursive: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://localhost:5173/");
    await page.getByLabel("Dashboard credential").fill(env.API_OPERATOR_TOKEN);
    await page.getByRole("dialog").getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    const cookies = await page.context().cookies();
    assert.ok(
      cookies.some((c) => c.name === "meridian_session" && c.httpOnly && c.sameSite === "Strict")
    );
    const read = async (endpoint) => {
      const response = await page.request.get(`http://localhost:5173/api/${endpoint}`);
      assert.equal(response.status(), 200);
      return response.json();
    };
    const before = await read("trading/state");
    await page.getByRole("link", { name: "Backtests", exact: true }).click();
    if (process.argv.includes("--submit")) {
      await page.locator(".simulation-disclosure summary").click();
      await page.getByLabel("From (UTC)", { exact: true }).fill("2026-10-09");
      await page.getByLabel("To (UTC, exclusive)", { exact: true }).fill("2026-10-10");
      const submitted = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === "/api/backtests/jobs" && r.request().method() === "POST"
      );
      await page.getByRole("button", { name: "Run simulation", exact: true }).click();
      const response = await submitted;
      assert.equal(response.status(), 202);
      const { job } = await response.json();
      let result = job;
      for (
        let attempt = 0;
        attempt < 40 && ["queued", "running"].includes(result.state);
        attempt++
      ) {
        await page.waitForTimeout(2000);
        result = (await read(`backtests/jobs/${job.jobId}`)).job;
      }
      assert.equal(result.state, "succeeded", result.error || "Simulation did not finish");
      await page.getByText("succeeded", { exact: true }).waitFor({ timeout: 10000 });
    }
    await page.getByText("96 points", { exact: true }).waitFor({ timeout: 15000 });
    const { runs } = await read("backtests?limit=100");
    const run = runs.find(
      (r) =>
        r.interval === "15m" &&
        r.fromMs === String(Date.parse("2026-10-09")) &&
        r.toMs === String(Date.parse("2026-10-10"))
    );
    assert.ok(run, "Expected saved simulation");
    const id = encodeURIComponent(run.runId);
    const detail = (await read(`backtests/${id}`)).run;
    const equity = await read(`backtests/${id}/equity?after=-1&limit=1000`);
    const fills = await read(`backtests/${id}/fills?after=-1&limit=200`);
    assert.equal(equity.items.length, 96);
    await page.waitForTimeout(700);
    const pixels = await page.locator(".backtest-result-chart").evaluateAll((nodes) =>
      nodes.map((node) => {
        const canvas = node.querySelector("canvas");
        const bytes = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        let visible = 0;
        for (let i = 3; i < bytes.length; i += 4) if (bytes[i]) visible++;
        return { width: canvas.width, height: canvas.height, visible };
      })
    );
    assert.equal(pixels.length, 2);
    assert.ok(pixels.every((p) => p.width > 100 && p.height > 100 && p.visible > 100));
    await page.screenshot({ path: path.join(output, "backtest-live-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, "backtest-live-mobile.png"), fullPage: true });
    const after = await read("trading/state");
    assert.deepEqual(after.orders, before.orders);
    assert.deepEqual(after.fills, before.fills);
    assert.deepEqual(after.riskControl, before.riskControl);
    assert.equal(after.riskControl?.engaged, true);
    const viewer = await browser.newContext();
    const login = await viewer.request.post("http://localhost:5173/api/auth/login", {
      headers: { Origin: "http://localhost:5173" },
      data: { token: env.API_VIEWER_TOKEN }
    });
    assert.equal(login.status(), 200);
    const denied = await viewer.request.post("http://localhost:5173/api/backtests/jobs", {
      headers: { Origin: "http://localhost:5173" },
      data: {
        requestId: require("node:crypto").randomUUID(),
        strategy: "ema",
        symbol: "BTCUSDT",
        interval: "15m",
        from: "2026-10-09",
        to: "2026-10-10"
      }
    });
    assert.equal(denied.status(), 403);
    await viewer.close();
    assert.deepEqual(errors, []);
    const report = {
      runId: run.runId,
      equityPoints: equity.items.length,
      simulatedFills: fills.items.length,
      metrics: detail.metrics,
      cookiesHttpOnly: true,
      viewerSubmissionDenied: true,
      tradingUnchanged: true,
      charts: pixels,
      errors
    };
    await fs.writeFile(
      path.join(output, "backtest-live-report.json"),
      JSON.stringify(report, null, 2)
    );
    console.log(JSON.stringify(report));
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
