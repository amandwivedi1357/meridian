const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

async function verifyChart(page) {
  await page.getByRole("button", { name: "Candlesticks", exact: true }).waitFor();
  const canvas = page.locator(".market-chart canvas").first();
  const pixels = await canvas.evaluate((canvas) => {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0,
      min = canvas.height,
      max = 0;
    for (let y = 0; y < canvas.height * 0.75; y++)
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if ((data[i + 1] > 110 && data[i] < 60) || (data[i] > 180 && data[i + 1] < 100)) {
          count++;
          min = Math.min(min, y);
          max = Math.max(max, y);
        }
      }
    return { count, span: max - min, height: canvas.height };
  });
  assert.ok(
    pixels.count > 100 && pixels.span > pixels.height * 0.2,
    "Candles must occupy a useful vertical price range"
  );
  const prior = await page.locator(".chart-readout time").innerText();
  const box = await page.locator(".market-chart").boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.waitForTimeout(150);
  assert.notEqual(
    await page.locator(".chart-readout time").innerText(),
    prior,
    "Crosshair must show hovered candle values"
  );
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await page.getByRole("button", { name: "Reset chart view", exact: true }).click();
  await page.getByRole("button", { name: "Line chart", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Line chart", exact: true })
      .getAttribute("aria-pressed"),
    "true"
  );
  await page.getByRole("button", { name: "Candlesticks", exact: true }).click();
  await page.getByRole("button", { name: "Fullscreen chart", exact: true }).click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.mouse.move(0, 0);
  return pixels;
}

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
      const reads = [];
      page.on("request", (req) => {
        if (
          req.url().includes("/api/") &&
          req.resourceType() !== "eventsource" &&
          !req.url().endsWith("/auth/login")
        )
          reads.push({ method: req.method(), url: new URL(req.url()).pathname });
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
      await page.getByText("Streaming", { exact: true }).waitFor({ timeout: 30000 });
      assert.equal(await page.getByRole("button", { name: "Emergency stop" }).isDisabled(), true);
      const before = await page.locator(".recent-trades-panel").innerText();
      const healthPanel = page.getByRole("region", { name: "System health", exact: true });
      await healthPanel.getByText("Connected", { exact: true }).waitFor();
      const healthCheckedAt = await healthPanel.getAttribute("data-checked-at");
      const bootstrapReads = reads.length;
      await page.waitForTimeout(6000);
      assert.notEqual(
        await healthPanel.getAttribute("data-checked-at"),
        healthCheckedAt,
        "Health must advance via SSE"
      );
      assert.ok((await healthPanel.innerText()).includes("Consumer groups"));
      assert.equal(reads.length, bootstrapReads, "Real healthy stream must not poll REST");
      assert.notEqual(
        await page.locator(".recent-trades-panel").innerText(),
        before,
        "Real trades must advance"
      );
      assert.ok(
        reads.every((r) => r.method === "GET"),
        "Real verification must remain read-only"
      );
      const chart = await verifyChart(page);
      for (const interval of ["1m", "5m", "1h", "15m"]) {
        const loaded = page.waitForResponse(
          (response) =>
            response.url().includes("/api/market/snapshot?") &&
            new URL(response.url()).searchParams.get("interval") === interval &&
            response.status() === 200
        );
        await page.getByRole("button", { name: interval, exact: true }).click();
        const history = await (await loaded).json();
        assert.equal(history.candles.length, 200);
        const step =
          interval === "1m"
            ? 60000
            : interval === "5m"
              ? 300000
              : interval === "1h"
                ? 3600000
                : 900000;
        assert.ok(
          Date.now() - history.candles[0].openTimeMs <= 201 * step,
          "History must be recent, not old DB fixtures"
        );
        await page.getByText("Streaming", { exact: true }).waitFor();
      }
      await page.getByRole("button", { name: "Reset chart view", exact: true }).click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(output, "real-desktop.png"), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(500);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(output, "real-mobile.png"), fullPage: true });
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({
          realApi: "passed",
          bootstrapReads,
          tradeTapeAdvanced: true,
          noPolling: true,
          healthPushed: true,
          readOnly: true,
          chart,
          errors
        })
      );
      return;
    }
    let role = "viewer",
      loggedIn = false,
      posts = 0,
      snapshots = 0;
    const portfolio = () => ({
      checkedAt: Date.now(),
      equity: null,
      equityReason: "unpriceable_wallet_assets",
      positions: [],
      totals: [],
      wallet: { status: "unpriceable", reconciliation: "unattributed", assets: [] }
    });
    const account = () => ({
      checkedAt: Date.now(),
      orders: [],
      fills: [],
      riskEvents: [],
      strategies: [
        { strategyId: "ema-test", paused: true, reason: "verification", updatedAtMs: Date.now() }
      ],
      riskControl: {
        scope: "global",
        engaged: true,
        reason: "verification",
        updatedAtMs: Date.now()
      },
      portfolio: portfolio()
    });
    await page.addInitScript(() => {
      window.__sources = [];
      window.EventSource = class {
        listeners = {};
        closed = false;
        constructor(url) {
          this.url = url;
          window.__sources.push(this);
          setTimeout(
            () => this.emit("ready", {}, url.includes("market") ? "bootstrap" : "0-0"),
            50
          );
        }
        addEventListener(type, fn) {
          this.listeners[type] = fn;
        }
        close() {
          this.closed = true;
        }
        emit(type, data, id = "next") {
          this.listeners[type]?.({ data: JSON.stringify(data), lastEventId: id });
        }
      };
    });
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      let data;
      if (req.method() === "POST") {
        posts++;
        if (url.pathname === "/api/auth/login") {
          assert.equal(JSON.parse(req.postData()).token, "v".repeat(32));
          loggedIn = true;
        } else if (url.pathname === "/api/auth/logout") loggedIn = false;
        else if (url.pathname.includes("kill-switch"))
          assert.equal(JSON.parse(req.postData()).reason, "browser verification");
        data = { ok: true };
      } else if (url.pathname === "/api/system/health")
        data = { checkedAt: Date.now(), redis: "available", database: "available", streams: [] };
      else if (url.pathname === "/api/auth/me")
        data = {
          principal: {
            role,
            actor: "fixture",
            ...(loggedIn ? { expiresAtMs: Date.now() + 900000 } : {})
          }
        };
      else if (url.pathname === "/api/trading/state") data = account();
      else if (url.pathname === "/api/account/summary") data = { portfolio: portfolio() };
      else if (url.pathname === "/api/market/snapshot") {
        snapshots++;
        const interval = url.searchParams.get("interval"),
          now = Date.now(),
          step =
            interval === "1h"
              ? 3600000
              : interval === "1m"
                ? 60000
                : interval === "5m"
                  ? 300000
                  : 900000;
        data = {
          symbol: "BTCUSDT",
          interval,
          cursor: "bootstrap",
          checkedAt: now,
          book: {
            bids: [{ price: "100", quantity: "2" }],
            asks: [{ price: "102", quantity: "3" }],
            lastUpdateId: 10,
            eventTimeMs: now,
            complete: false
          },
          trades: [
            {
              symbol: "BTCUSDT",
              tradeId: "1",
              price: "101",
              quantity: "0.1",
              eventTimeMs: now,
              isBuyerMaker: false
            }
          ],
          candles: Array.from({ length: 40 }, (_, i) => ({
            symbol: "BTCUSDT",
            interval,
            openTimeMs: Math.floor(now / step) * step - (40 - i) * step,
            closeTimeMs: Math.floor(now / step) * step - (39 - i) * step - 1,
            open: String(100 + i / 10),
            high: String(102 + i / 10),
            low: String(99 + i / 10),
            close: String(101 + i / 10),
            volume: "10",
            closed: true
          }))
        };
      } else throw new Error(`Unexpected API: ${url.pathname}`);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(data)
      });
    });
    await page.goto("http://127.0.0.1:5173/");
    await page.getByText("Streaming", { exact: true }).waitFor();
    const healthPanel = page.getByRole("region", { name: "System health", exact: true });
    await page.evaluate(() =>
      window.__sources
        .find((s) => !s.closed && s.url.includes("account"))
        .emit("health", {
          checkedAt: Date.now(),
          redis: "unavailable",
          database: "available",
          streams: [
            {
              stream: "signals",
              status: "available",
              length: 12,
              groups: [{ name: "executor", consumers: 0, pending: 4, lag: null }]
            }
          ]
        })
    );
    await healthPanel.getByText("Degraded", { exact: true }).waitFor();
    await healthPanel.getByText("Unknown / 4", { exact: true }).waitFor();
    await page.evaluate(() => {
      const source = window.__sources.find((s) => !s.closed && s.url.includes("account"));
      source.emit("health", {});
      source.emit("health", {
        checkedAt: Date.now() - 20000,
        redis: "available",
        database: "available",
        streams: []
      });
    });
    await healthPanel.getByText("Stale", { exact: true }).waitFor();
    assert.equal(await healthPanel.getByText("Unknown", { exact: true }).count(), 2);
    await page.evaluate(() =>
      window.__sources
        .find((s) => !s.closed && s.url.includes("account"))
        .emit("health", {
          checkedAt: Date.now(),
          redis: "available",
          database: "available",
          streams: []
        })
    );
    await verifyChart(page);
    assert.equal(await page.getByRole("button", { name: "Emergency stop" }).isDisabled(), true);
    await page.screenshot({ path: path.join(output, "desktop.png"), fullPage: true });
    const initial = snapshots;
    await page.waitForTimeout(2500);
    assert.equal(snapshots, initial, "Healthy channels must not poll");
    const pixels = await page
      .locator(".market-chart canvas")
      .first()
      .evaluate((canvas) => {
        const ctx = canvas.getContext("2d");
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let colored = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i + 1] > 100 && data[i] < 80) colored++;
        return { width: canvas.width, height: canvas.height, colored };
      });
    assert.ok(
      pixels.width > 100 && pixels.height > 100 && pixels.colored > 20,
      "Candlestick canvas must render"
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Dashboard credential").fill("v".repeat(32));
    role = "operator";
    await page.getByRole("dialog").getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.waitForFunction(
      () => document.querySelector(".emergency-button")?.disabled === false
    );
    assert.deepEqual(
      await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
      { local: 0, session: 0 }
    );
    await page.getByRole("button", { name: "Emergency stop" }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(posts, 1, "Cancel must not issue control POST");
    await page.getByRole("button", { name: "Emergency stop" }).click();
    await page.getByLabel("Reason").fill("browser verification");
    await page.getByRole("button", { name: "Confirm stop" }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(posts, 2);
    await page.getByRole("button", { name: "1h", exact: true }).click();
    await page.waitForTimeout(200);
    assert.ok(
      await page.evaluate(() =>
        window.__sources.filter((s) => !s.closed).every((s) => s.url.includes("interval=1h"))
      )
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "Mobile must not overflow"
    );
    await page.screenshot({ path: path.join(output, "mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    assert.ok(await page.evaluate(() => window.__sources.every((s) => s.closed)));
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        browser: "passed",
        canvas: pixels,
        snapshots,
        posts,
        mockedControls: true,
        errors
      })
    );
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
