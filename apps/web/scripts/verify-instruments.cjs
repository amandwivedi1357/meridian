/* global window */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { parseEnv } = require("node:util");
const { URL } = require("node:url");
const { setTimeout: sleep } = require("node:timers/promises");
const { fetch, AbortSignal } = globalThis;
async function main() {
  const { chromium } = require(
    process.env.PLAYWRIGHT_MODULE ||
      "C:/Users/thinkpad/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
  );
  const env = parseEnv(await fs.readFile(".env", "utf8"));
  const output = path.resolve("logs/verification/instruments");
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const results = [];
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    const mutations = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && !new URL(request.url()).pathname.endsWith("/auth/login"))
        mutations.push(new URL(request.url()).pathname);
    });
    let failed = true;
    await page.route("**/api/market/instruments?*", async (route) => {
      if (failed)
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "instruments_unavailable" })
        });
      else await route.continue();
    });
    await page.goto("http://127.0.0.1:5173/#/market");
    const login = page.getByRole("dialog");
    await page.getByLabel("Dashboard credential").fill(env.API_VIEWER_TOKEN);
    await login.getByRole("button", { name: "Sign in", exact: true }).click();
    await login.waitFor({ state: "hidden" });
    await page.getByRole("alert").filter({ hasText: "Instrument list unavailable" }).waitFor();
    failed = false;
    await page.getByRole("button", { name: "Retry instrument list" }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".instrument-picker option").length > 10
    );
    const count = await page.locator(".instrument-picker option").count();
    assert(count > 10);
    for (const [symbol, base] of [
      ["BTCUSDT", "BTC"],
      ["ETHUSDT", "ETH"],
      ["SOLUSDT", "SOL"],
      ["BNBUSDT", "BNB"]
    ]) {
      await page.locator(".instrument-picker select").selectOption(symbol);
      await page.getByRole("heading", { name: symbol, exact: true }).waitFor();
      await page.getByText(`${base}/USDT`, { exact: true }).waitFor();
      const tape = page
        .locator(".market-page-layout aside section")
        .filter({ has: page.getByRole("heading", { name: "Recent trade tape", exact: true }) });
      await page.waitForFunction(
        () => {
          const sections = [...document.querySelectorAll(".market-page-layout aside section")];
          const tape = sections.find(
            (section) => section.querySelector("h2")?.textContent === "Recent trade tape"
          );
          return (tape?.querySelectorAll(".tape-print").length ?? 0) >= 3;
        },
        undefined,
        { timeout: 60000 }
      );
      assert((await tape.locator(".tape-scroll").textContent()).trim().length > 10);
      let connectionHealthy = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        const response = await fetch("http://127.0.0.1:9401/metrics", {
          signal: AbortSignal.timeout(5000)
        });
        assert.equal(response.status, 200);
        const metrics = await response.text();
        connectionHealthy = metrics
          .split("\n")
          .some(
            (line) =>
              line.startsWith("meridian_market_connection_ready{") &&
              line.includes(`symbol="${symbol}"`) &&
              line.endsWith(" 1")
          );
        if (connectionHealthy) break;
        await sleep(1000);
      }
      assert.ok(connectionHealthy, `${symbol} active-feed readiness must be observed`);
      const pixels = await page
        .locator(".market-chart canvas")
        .first()
        .evaluate((canvas) => {
          const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
          let count = 0;
          for (let i = 0; i < data.length; i += 4)
            if ((data[i + 1] > 100 && data[i] < 80) || (data[i] > 180 && data[i + 1] < 100))
              count++;
          return count;
        });
      assert(pixels > 100, `${symbol} chart must contain actual candles`);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
        false
      );
      await page.screenshot({ path: path.join(output, `${symbol}.png`), fullPage: true });
      results.push({ symbol, liveTrades: true, connectionHealthy, chartPixels: pixels });
    }
    const tradeButton = page.getByRole("button", { name: "Trade", exact: true });
    await tradeButton.click();
    const drawer = page.getByRole("dialog", { name: "Trade", exact: true });
    await drawer.waitFor();
    await drawer.evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished))
    );
    await drawer.getByLabel(`Quantity / BNB`).fill("0.0001");
    await page.screenshot({ path: path.join(output, "trade-drawer-desktop.png"), fullPage: false });
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden" });
    assert.equal(await tradeButton.evaluate((element) => element === document.activeElement), true);
    await tradeButton.click();
    assert.equal(await drawer.getByLabel("Quantity / BNB").inputValue(), "0.0001");
    await drawer.getByRole("button", { name: "Close trade drawer" }).click();
    await tradeButton.click();
    await drawer.evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished))
    );
    await page.mouse.click(10, 120);
    await drawer.waitFor({ state: "hidden" });
    await page.setViewportSize({ width: 390, height: 844 });
    const chartBounds = await page.locator(".market-primary").boundingBox();
    const feedBounds = await page.locator(".market-microstructure").boundingBox();
    const ticketBounds = await page.locator(".market-secondary").boundingBox();
    assert.ok(feedBounds.y >= chartBounds.y + chartBounds.height, "Mobile feed follows chart");
    assert.ok(
      ticketBounds.y >= feedBounds.y + feedBounds.height,
      "Mobile health follows feed panels"
    );
    await page.screenshot({ path: path.join(output, "mobile.png"), fullPage: true });
    await tradeButton.click();
    await drawer.waitFor();
    await drawer.evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished))
    );
    const drawerBounds = await drawer.boundingBox();
    assert.ok(
      drawerBounds.x >= 0 &&
        drawerBounds.x + drawerBounds.width <= 390 &&
        drawerBounds.height <= 844
    );
    await page.screenshot({ path: path.join(output, "trade-drawer-mobile.png"), fullPage: false });
    await drawer.getByRole("button", { name: "Close trade drawer" }).click();
    assert.equal(await page.locator(".market-secondary .manual-trade-panel").count(), 0);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false
    );
    assert.deepEqual(mutations, []);
    assert.deepEqual(errors, []);
    await context.close();
    const result = {
      passed: true,
      instruments: count,
      visibleFailureRetry: true,
      results,
      mobile: true,
      tradeDrawer: true,
      tradingMutations: 0
    };
    await fs.writeFile(path.join(output, "browser.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
