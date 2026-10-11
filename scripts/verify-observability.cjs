const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Buffer } = require("node:buffer");
const { URL } = require("node:url");
const { setTimeout } = require("node:timers");
const { fetch, AbortSignal } = globalThis;

async function main() {
  const password = process.env.GRAFANA_VERIFY_PASSWORD;
  if (!password) throw new Error("Set GRAFANA_VERIFY_PASSWORD for the local verification account");
  const user = process.env.GRAFANA_VERIFY_USER || "admin";
  const grafana = "http://127.0.0.1:3001";
  const prometheus = "http://127.0.0.1:9090";
  const authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  async function json(url, headers = {}) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, `HTTP ${response.status}: ${new URL(url).pathname}`);
    return response.json();
  }
  async function query(expr) {
    const response = await json(`${prometheus}/api/v1/query?query=${encodeURIComponent(expr)}`);
    assert.equal(response.status, "success");
    return response.data.result;
  }
  const deadline = Date.now() + 120000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const targets = await json(`${prometheus}/api/v1/targets`);
      const active = targets.data.activeTargets.filter((target) =>
        ["meridian-api", "meridian-ingestor"].includes(target.labels.job)
      );
      ready = active.length === 2 && active.every((target) => target.health === "up");
      if (ready) {
        const worker = await query("meridian_backtest_dispatcher_ready");
        ready = worker.length === 1 && worker[0].value[1] === "1";
      }
      if (ready) break;
    } catch {
      /* Initial container startup and feed lease handoff are bounded. */
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  assert.ok(ready, "API and public-feed scrapes must actually succeed");
  const dependencies = await query("meridian_dependency_available");
  assert.equal(dependencies.length, 2);
  assert.ok(dependencies.every((row) => row.value[1] === "1"));
  const age = await query("ws_last_message_age_seconds");
  assert.equal(age.length, 1);
  assert.ok(Number(age[0].value[1]) >= 0 && Number(age[0].value[1]) <= 15);
  let alerts = [];
  const ruleDeadline = Date.now() + 60000;
  while (Date.now() < ruleDeadline) {
    const rules = await json(`${prometheus}/api/v1/rules`);
    alerts = rules.data.groups
      .flatMap((group) => group.rules)
      .filter((rule) => rule.name.startsWith("Meridian"));
    if (alerts.length === 14 && alerts.every((rule) => rule.health === "ok")) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  assert.equal(alerts.length, 14);
  assert.ok(alerts.every((rule) => rule.health === "ok"));
  const evidence = {
    checkedAt: new Date().toISOString(),
    targets: await query('up{job=~"meridian-.*"}'),
    dependencies,
    upstreamAge: age,
    rules: alerts.map(({ name, health, state }) => ({ name, health, state })),
    dashboards: []
  };
  const output = path.resolve("logs/verification/phase-5");
  await fs.mkdir(output, { recursive: true });
  const playwright = require(
    process.env.PLAYWRIGHT_MODULE ||
      "C:/Users/thinkpad/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
  );
  const browser = await playwright.chromium.launch({ headless: true, channel: "chrome" });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 2200 } });
    const login = await context.request.post(`${grafana}/login`, { data: { user, password } });
    assert.equal(login.status(), 200, "Grafana login failed");
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.url().includes("/api/ds/query") && response.status() >= 400)
        errors.push(`Datasource HTTP ${response.status()}`);
    });
    for (const uid of ["meridian-operations", "meridian-trading-risk", "meridian-pnl-risk"]) {
      const saved = await json(`${grafana}/api/dashboards/uid/${uid}`, { authorization });
      assert.equal(saved.meta.provisioned, true);
      assert.ok(saved.dashboard.panels.length > 0);
      for (const panel of saved.dashboard.panels) {
        assert.equal(panel.datasource.uid, "meridian-prometheus");
        for (const target of panel.targets) await query(target.expr);
      }
      await page.goto(`${grafana}${saved.meta.url}?orgId=1`, { waitUntil: "domcontentloaded" });
      await page.getByText(saved.dashboard.title, { exact: true }).first().waitFor();
      await page.waitForTimeout(7000);
      await page.screenshot({ path: path.join(output, `${uid}.png`), fullPage: true });
      evidence.dashboards.push({
        uid,
        title: saved.dashboard.title,
        panels: saved.dashboard.panels.length,
        provisioned: true
      });
    }
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
  await fs.writeFile(path.join(output, "observability.json"), JSON.stringify(evidence, null, 2));
  console.log(
    JSON.stringify({
      success: true,
      dashboards: evidence.dashboards,
      ruleCount: alerts.length,
      output
    })
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
