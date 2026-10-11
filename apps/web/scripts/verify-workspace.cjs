/* global window, URL, setTimeout */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { parseEnv } = require("node:util");

async function main() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const output = path.resolve("logs/verification/workspace");
  await fs.mkdir(output, { recursive: true });
  const errors = [],
    screenshots = [],
    posts = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.method() === "POST") posts.push(new URL(r.url()).pathname);
    });
    await page.goto("http://127.0.0.1:5173/");
    const env = parseEnv(await fs.readFile(".env", "utf8"));
    if (env.API_VIEWER_TOKEN) {
      await page.getByLabel("Dashboard credential").fill(env.API_VIEWER_TOKEN);
      await page.getByRole("dialog").getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
    }
    await page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
    await page.getByText("Streaming", { exact: true }).waitFor({ timeout: 30000 });
    const names = ["Overview", "Market", "Trading", "Risk", "Strategies", "Backtests", "System"];
    const report = [];
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const name of names) {
        await page
          .getByRole("navigation", { name: "Primary" })
          .getByRole("link", { name, exact: true })
          .click();
        await page.getByRole("heading", { name, exact: true }).waitFor();
        await page.waitForTimeout(600);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth
        );
        assert.equal(overflow, false, `${name} must not overflow viewport at ${width}px`);
        if (name === "Risk")
          assert.equal(
            await page
              .getByRole("button", { name: "Engage kill switch", exact: true })
              .isDisabled(),
            true
          );
        if (name === "Market") {
          assert.equal(
            await page.getByRole("group", { name: "Candle interval" }).getByRole("button").count(),
            3
          );
          const pixels = await page
            .locator(".market-chart canvas")
            .first()
            .evaluate((canvas) => {
              const data = canvas
                .getContext("2d")
                .getImageData(0, 0, canvas.width, canvas.height).data;
              let colored = 0;
              for (let i = 0; i < data.length; i += 4)
                if ((data[i + 1] > 110 && data[i] < 60) || (data[i] > 180 && data[i + 1] < 100))
                  colored++;
              return colored;
            });
          assert.ok(pixels > 100, "Real candle chart must be nonblank");
          for (const interval of ["1m", "1h", "15m"]) {
            await page
              .getByRole("group", { name: "Candle interval" })
              .getByRole("button", { name: interval, exact: true })
              .click();
            await page.waitForTimeout(800);
            await page.waitForFunction(
              (value) => document.querySelector(".chart-source")?.textContent.includes(value),
              interval
            );
          }
          const columns = await page
            .locator(".market-chart canvas")
            .first()
            .evaluate((canvas) => {
              const data = canvas
                .getContext("2d")
                .getImageData(0, 0, canvas.width, canvas.height).data;
              let count = 0;
              for (let x = 0; x < canvas.width * 0.7; x++) {
                let found = false;
                for (let y = 0; y < canvas.height * 0.7 && !found; y++) {
                  const i = (y * canvas.width + x) * 4;
                  found =
                    (data[i + 1] > 110 && data[i] < 60) || (data[i] > 180 && data[i + 1] < 100);
                }
                if (found) count++;
              }
              return count;
            });
          assert.ok(columns > 30, "Candle history must remain framed after interval changes");
        }
        const file = path.join(output, `${name.toLowerCase()}-${width}.png`);
        await page.mouse.move(width - 5, 5);
        await page.screenshot({ path: file, fullPage: true });
        screenshots.push(file);
        report.push({ name, width, overflow });
      }
    }
    await page.reload();
    await page.getByRole("heading", { name: "System", exact: true }).waitFor();
    assert.equal(new URL(page.url()).hash, "#/system", "Reload must preserve page");
    const trading = await (
      await context.request.get("http://127.0.0.1:5173/api/trading/state")
    ).json();
    const market = await (
      await context.request.get(
        "http://127.0.0.1:5173/api/market/snapshot?symbol=BTCUSDT&interval=15m"
      )
    ).json();
    const portfolio = await (
      await context.request.get("http://127.0.0.1:5173/api/account/summary")
    ).json();
    const health = await (
      await context.request.get("http://127.0.0.1:5173/api/system/health")
    ).json();
    const summaryResponse = await context.request.get("http://127.0.0.1:5173/api/system/workspace");
    assert.equal(summaryResponse.status(), 200);
    const summary = await summaryResponse.json();
    assert.ok(Array.isArray(summary.audits));
    assert.ok(Array.isArray(summary.migrations));
    const saved = await (
      await context.request.get("http://127.0.0.1:5173/api/backtests?limit=1")
    ).json();
    if (saved.runs.length) {
      const html = await context.request.get(
        `http://127.0.0.1:5173/api/backtests/${encodeURIComponent(saved.runs[0].runId)}/report`
      );
      assert.equal(html.status(), 200);
      assert.ok(html.headers()["content-type"].includes("text/html"));
      assert.ok((await html.text()).includes("Backtest report"));
    }
    const mocked = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    await mocked.addInitScript(() => {
      window.EventSource = class {
        listeners = {};
        constructor() {
          setTimeout(() => this.listeners.ready?.({ data: "{}", lastEventId: "bootstrap" }), 30);
        }
        addEventListener(type, fn) {
          this.listeners[type] = fn;
        }
        close() {}
      };
    });
    const fixturePosts = [];
    await mocked.route("**/api/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const account = {
        ...trading,
        checkedAt: Date.now(),
        strategies: [
          { strategyId: "fixture-ema", paused: true, reason: "fixture", updatedAtMs: Date.now() }
        ]
      };
      let data;
      if (request.method() === "POST") {
        fixturePosts.push({ url: url.pathname, body: JSON.parse(request.postData()) });
        data = { ok: true };
      } else if (url.pathname === "/api/auth/me")
        data = { principal: { actor: "fixture", role: "operator" } };
      else if (url.pathname === "/api/trading/state") data = account;
      else if (url.pathname === "/api/account/summary") data = portfolio;
      else if (url.pathname === "/api/market/snapshot") data = market;
      else if (url.pathname === "/api/system/health") data = { ...health, checkedAt: Date.now() };
      else if (url.pathname === "/api/system/workspace") data = summary;
      else throw new Error(`Unexpected fixture request: ${url.pathname}`);
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    const operator = await mocked.newPage();
    operator.on("pageerror", (e) => errors.push(e.message));
    await operator.goto("http://127.0.0.1:5173/#/risk");
    const kill = operator.getByRole("button", { name: "Engage kill switch", exact: true });
    await kill.waitFor();
    await operator.waitForTimeout(200);
    await kill.click();
    let dialog = operator.getByRole("dialog");
    const confirmKill = dialog.getByRole("button", { name: "Engage kill switch", exact: true });
    assert.equal(await confirmKill.isDisabled(), true);
    await dialog.getByLabel("Reason").fill("UI fixture verification");
    assert.equal(await confirmKill.isDisabled(), true);
    await dialog.getByLabel("Type STOP to confirm").fill("STOP");
    await confirmKill.click();
    await dialog.waitFor({ state: "hidden" });
    await operator.getByRole("link", { name: "Strategies", exact: true }).click();
    await operator.getByRole("button", { name: "Request resume" }).click();
    dialog = operator.getByRole("dialog");
    const resume = dialog.getByRole("button", { name: "Confirm resume", exact: true });
    assert.equal(await resume.isDisabled(), true);
    await dialog.getByLabel("Reason").fill("UI fixture verification");
    await dialog.getByLabel("Type RESUME to confirm").fill("RESUME");
    await resume.click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(fixturePosts.length, 2);
    assert.equal(fixturePosts[1].body.confirm, "RESUME_STRATEGY");
    assert.deepEqual(posts, env.API_VIEWER_TOKEN ? ["/api/auth/login"] : []);
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(output, "verification.json"),
      JSON.stringify(
        {
          pages: report,
          errors,
          realControlPosts: 0,
          mockedConfirmationPosts: fixturePosts.length
        },
        null,
        2
      )
    );
    console.log(
      JSON.stringify({
        pages: report.length,
        errors,
        realControlPosts: 0,
        mockedConfirmationPosts: fixturePosts.length,
        output
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
