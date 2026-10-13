/* global window, setTimeout, innerWidth */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");
async function main() {
  const { chromium } = require(
    process.env.PLAYWRIGHT_MODULE ||
      "C:/Users/thinkpad/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
  );
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const output = path.resolve("logs/verification/order-fixes");
  await fs.mkdir(output, { recursive: true });
  const requests = [],
    errors = [];
  let complete = true;
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.EventSource = class {
        addEventListener(type, handler) {
          if (type === "ready")
            setTimeout(() => handler({ lastEventId: "fixture", data: "{}" }), 20);
        }
        close() {}
      };
    });
    const fill = {
      clientOrderId: "fixture",
      strategyId: "manual",
      executionId: "1",
      tradeId: "1",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "1",
      price: "10",
      fee: "0",
      feeAsset: "USDT",
      eventTimeMs: 1
    };
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        now = Date.now();
      let data = { checkedAt: now };
      if (url.pathname === "/api/auth/me")
        data = { principal: { role: "operator", actor: "fixture" } };
      else if (url.pathname === "/api/market/instruments")
        data = {
          instruments: [
            { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING" }
          ],
          checkedAt: now
        };
      else if (url.pathname === "/api/system/health")
        data = { checkedAt: now, redis: "available", database: "available", streams: [] };
      else if (url.pathname === "/api/trading/state")
        data = {
          checkedAt: now,
          orders: [],
          fills: [fill],
          riskEvents: [],
          strategies: [],
          riskControl: {
            scope: "global",
            engaged: false,
            reason: "mocked verification",
            updatedAtMs: now
          }
        };
      else if (url.pathname === "/api/account/summary")
        data = {
          checkedAt: now,
          portfolio: {
            checkedAt: now,
            equity: null,
            equityReason: "fixture",
            positions: [
              {
                symbol: "BTCUSDT",
                quantity: "1",
                avgEntry: "10",
                markPrice: "12",
                realizedPnl: "0",
                unrealizedPnl: "2",
                status: "available",
                reason: null
              }
            ],
            totals: []
          }
        };
      else if (url.pathname === "/api/market/snapshot")
        data = {
          symbol: "BTCUSDT",
          interval: url.searchParams.get("interval"),
          cursor: "fixture",
          checkedAt: now,
          book: null,
          trades: [],
          candles: []
        };
      else if (url.pathname === "/api/dashboard")
        data = {
          checkedAt: now,
          symbol: "BTCUSDT",
          source: "fixture",
          feed: "waiting",
          trades: [],
          redis: { available: true, count: 0, memoryBytes: 0 },
          database: { available: true, count: 0, checkedAt: now },
          recording: null
        };
      else if (url.pathname === "/api/fills/report")
        data = { checkedAt: now, complete, fills: complete ? [fill] : [] };
      else if (url.pathname === "/api/orders/manual") {
        requests.push(JSON.parse(req.postData()));
        if (requests.length === 1) {
          await route.abort("failed");
          return;
        }
        data = {
          checkedAt: now,
          stream: "signals",
          streamId: "1-0",
          signalId: "fixture",
          strategyId: "manual",
          status: "queued"
        };
      } else if (req.method() !== "GET") throw new Error("Unexpected non-fixture write");
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    await page.goto((process.env.WEB_VERIFY_URL || "http://127.0.0.1:5174") + "/#/market");
    await page.getByRole("button", { name: "Trade", exact: true }).click();
    const ticket = page.locator(".manual-trade-panel");
    await ticket.getByLabel("Quantity / BTC").fill("0.0002");
    await ticket.getByLabel("Reason", { exact: true }).fill("mocked retry");
    await ticket.getByLabel("Confirm", { exact: true }).fill("QUEUE");
    await ticket.getByRole("button", { name: "BUY market order", exact: true }).click();
    await ticket.getByRole("alert").waitFor();
    await ticket.getByRole("button", { name: "Start a separate request", exact: true }).click();
    const confirmation = page.getByRole("dialog", {
      name: "Start a separate order request",
      exact: true
    });
    await confirmation.waitFor();
    await page.keyboard.press("Escape");
    await confirmation.waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("dialog", { name: "Trade", exact: true }).isVisible(), true);
    await page.reload();
    await page.getByRole("button", { name: "Trade", exact: true }).click();
    await ticket.getByRole("button", { name: "Retry original request", exact: true }).click();
    await ticket.getByRole("status").filter({ hasText: "Queued" }).waitFor();
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], requests[1]);
    await page.goto((process.env.WEB_VERIFY_URL || "http://127.0.0.1:5174") + "/#/reports");
    await page.locator(".report-equity-card strong").filter({ hasText: "102" }).waitFor();
    await page.screenshot({ path: path.join(output, "report-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false
    );
    await page.screenshot({ path: path.join(output, "report-mobile.png"), fullPage: true });
    complete = false;
    await page.reload();
    await page.getByRole("status").filter({ hasText: "Complete fill history" }).waitFor();
    assert.equal(await page.locator(".report-equity-card").count(), 0);
    assert.deepEqual(errors, []);
    const result = {
      passed: true,
      mockedBrowser: true,
      reloadRetrySameIdentity: true,
      completeReport: true,
      incompleteHistoryWithheld: true,
      mobile: true,
      realTradingRequests: 0
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
