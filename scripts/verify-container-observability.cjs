/* global __dirname */
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { setTimeout: sleep } = require("node:timers/promises");
const { containerConfig } = require("./containers/observability-config.cjs");
const { fetch, AbortSignal } = globalThis;
const root = path.resolve(__dirname, "..");
const id = randomUUID().replaceAll("-", "");
const label = `meridian.observability-verification=${id}`;
const network = `meridian-observability-${id}`;
const egress = `${network}-delivery`;
const owned = [];
const networks = [];
const checks = [];
const output = path.join(root, "logs/verification/phase-5", network);
const secretFile = path.join(root, "infra/alertmanager/.local", `${id}.json`);
const docker = (...args) =>
  execFileSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000,
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
const inspect = (name) => JSON.parse(docker("inspect", name))[0];
const bind = (source, target) => [
  "--mount",
  `type=bind,source=${source},target=${target},readonly`
];
const port = (name, number) =>
  Number(inspect(name).NetworkSettings.Ports[`${number}/tcp`][0].HostPort);
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
  assert(response.ok, `Verification HTTP ${response.status}`);
  return response;
}
async function wait(check, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (await check()) return;
    } catch {
      /* Bounded startup/scrape/recovery. */
    }
    await sleep(1500);
  }
  throw new Error("Container observability check timed out");
}
function start(key, image, args = [], extra = []) {
  const name = `${network}-${key}`;
  owned.push(name);
  docker(
    "run",
    "-d",
    "--name",
    name,
    "--label",
    label,
    "--network",
    network,
    "--network-alias",
    key,
    ...extra,
    image,
    ...args
  );
  return name;
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  let failure, browser;
  let sent = 0;
  let rules = [];
  const dashboardEvidence = [];
  const imageEvidence = [];
  try {
    // Reuse only the locally configured private Telegram destination; never print it.
    const saved = JSON.parse(
      await fs.readFile(path.join(root, "infra/alertmanager/.local/alertmanager.yml"), "utf8")
    );
    const receiver = saved.receivers.find((r) => r.name === "telegram");
    assert(receiver?.telegram_configs?.[0]?.bot_token, "Private Telegram config missing");
    const delivery = {
      route: {
        receiver: "discard",
        group_by: ["alertname", "verification_id"],
        group_wait: "5s",
        group_interval: "10s",
        repeat_interval: "4h",
        routes: [
          {
            receiver: "telegram",
            matchers: [
              `verification_id="${id}"`,
              'alertname="MeridianDependencyUnavailable"',
              'job="meridian-api"'
            ]
          }
        ]
      },
      receivers: [{ name: "discard" }, receiver]
    };
    await fs.writeFile(secretFile, JSON.stringify(delivery), { mode: 0o600 });
    const config = containerConfig(["market", "alerts"]);
    config.global.scrape_interval = "5s";
    config.global.evaluation_interval = "5s";
    config.global.external_labels = { verification_id: id };
    const configFile = path.join(output, "prometheus.json");
    await fs.writeFile(configFile, JSON.stringify(config));
    for (const name of [network, egress]) {
      docker(
        "network",
        "create",
        ...(name === network ? ["--internal"] : []),
        "--label",
        label,
        name
      );
      networks.push(name);
    }
    const redis = start("redis", "redis:7-alpine", ["redis-server", "--appendonly", "yes"]);
    const db = start(
      "database",
      "timescale/timescaledb:latest-pg16",
      [
        "postgres",
        "-c",
        "shared_buffers=64MB",
        "-c",
        "max_worker_processes=8",
        "-c",
        "timescaledb.max_background_workers=4"
      ],
      [
        "-e",
        "POSTGRES_USER=fixture",
        "-e",
        "POSTGRES_PASSWORD=fixture",
        "-e",
        "POSTGRES_DB=fixture"
      ]
    );
    await wait(() => docker("exec", redis, "redis-cli", "ping") === "PONG");
    await wait(() => {
      docker("exec", db, "pg_isready", "-h", "127.0.0.1", "-U", "fixture");
      return true;
    });
    const env = {
      DATABASE_URL: "postgres://fixture:fixture@database:5432/fixture",
      REDIS_URL: "redis://redis:6379",
      JWT_SECRET: "isolated-observability-fixture-secret-not-for-deployment",
      API_VIEWER_TOKEN: "isolated-observability-viewer-fixture",
      API_ALLOWED_ORIGINS: "https://fixture.invalid",
      API_HOST: "0.0.0.0",
      DIAGNOSTICS_HOST: "0.0.0.0",
      BINANCE_ENV: "testnet"
    };
    const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    const harden = [
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--tmpfs",
      "/tmp:uid=1000,gid=1000,size=64m",
      "--tmpfs",
      "/app/logs:uid=1000,gid=1000,size=16m"
    ];
    const backtest = start(
      "backtest",
      "meridian/backtest-worker:local",
      ["list"],
      [...envArgs, ...harden]
    );
    await wait(() => !inspect(backtest).State.Running);
    assert.equal(inspect(backtest).State.ExitCode, 0);
    const api = start("api", "meridian/api:local", [], [...envArgs, ...harden]);
    const feed = start("ingestor", "meridian/ingestor:local", [], [...envArgs, ...harden]);
    const web = start(
      "web",
      "meridian/web:local",
      [],
      [
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--tmpfs",
        "/tmp:uid=101,gid=101,size=32m"
      ]
    );
    for (const [service, name] of [
      ["api", api],
      ["ingestor", feed],
      ["web", web]
    ])
      imageEvidence.push({ service, imageId: inspect(name).Image });
    const exporter = start(
      "blackbox",
      "prom/blackbox-exporter:v0.29.0@sha256:9613f2884689b6fad9f1939f6a3b0388c93a022cfaededb19545b329b5c83dea",
      ["--config.file=/etc/blackbox/blackbox.yml"],
      bind(path.join(root, "infra/prometheus/blackbox.yml"), "/etc/blackbox/blackbox.yml")
    );
    assert(inspect(exporter).Config.User !== "0");
    const alertmanager = start(
      "alertmanager",
      "prom/alertmanager:v0.28.1",
      ["--config.file=/etc/alertmanager/config.json", "--cluster.listen-address="],
      [...bind(secretFile, "/etc/alertmanager/config.json"), "-p", "127.0.0.1::9093"]
    );
    // Exchange-capable applications stay internal; monitoring tools alone get egress.
    docker("network", "connect", egress, alertmanager);
    const prom = start(
      "prometheus",
      "prom/prometheus:v2.54.1",
      [],
      [
        ...bind(configFile, "/etc/prometheus/prometheus.yml"),
        ...bind(path.join(root, "infra/prometheus/rules"), "/etc/prometheus/rules"),
        "-p",
        "127.0.0.1::9090"
      ]
    );
    docker("network", "connect", egress, prom);
    const password = randomUUID();
    const grafana = start(
      "grafana",
      "grafana/grafana:11.2.0",
      [],
      [
        ...bind(path.join(root, "infra/grafana/provisioning"), "/etc/grafana/provisioning"),
        ...bind(path.join(root, "infra/grafana/dashboards"), "/var/lib/grafana/dashboards"),
        "-e",
        "GF_SECURITY_ADMIN_PASSWORD=" + password,
        "-e",
        "GF_USERS_ALLOW_SIGN_UP=false",
        "-p",
        "127.0.0.1::3000"
      ]
    );
    docker("network", "connect", egress, grafana);
    const promUrl = `http://127.0.0.1:${port(prom, 9090)}`;
    const grafanaUrl = `http://127.0.0.1:${port(grafana, 3000)}`;
    const alertUrl = `http://127.0.0.1:${port(alertmanager, 9093)}`;
    async function query(expr) {
      const result = await (
        await request(`${promUrl}/api/v1/query?query=${encodeURIComponent(expr)}`)
      ).json();
      assert.equal(result.status, "success");
      return result.data.result;
    }
    await wait(async () => {
      const rows = await query('up{job=~"meridian-api|meridian-ingestor"}');
      return rows.length === 2 && rows.every((r) => r.value[1] === "1");
    });
    await wait(
      async () =>
        (await query('probe_success{service="web"}')).length === 2 &&
        (await query('probe_success{service="web"}')).every((r) => r.value[1] === "1")
    );
    await wait(async () => (await query("meridian_ledger_sample_available"))[0]?.value[1] === "1");
    assert.equal((await query('probe_success{service="ingestor",check="ready"}'))[0].value[1], "0");
    assert.equal((await query('probe_success{service="ingestor",check="live"}'))[0].value[1], "1");
    assert.equal((await query("meridian_backtest_dispatcher_ready"))[0].value[1], "1");
    assert.equal((await query("meridian_backtest_jobs_by_state")).length, 4);
    checks.push(
      "Real API/feed image scrapes; Web health probes; truthful isolated-feed not-ready; durable job/ledger and dispatcher metrics"
    );
    await wait(async () => {
      const result = await (await request(`${promUrl}/api/v1/rules`)).json();
      rules = result.data.groups.flatMap((g) => g.rules);
      return rules.length === 16 && rules.every((r) => r.health === "ok");
    });
    checks.push("All sixteen production alert rules evaluate successfully");
    await wait(async () => (await request(`${grafanaUrl}/api/health`)).ok);
    const playwright = require(
      process.env.PLAYWRIGHT_MODULE ||
        "C:/Users/thinkpad/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
    );
    browser = await playwright.chromium.launch({ headless: true, channel: "chrome" });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
    const login = await context.request.post(`${grafanaUrl}/login`, {
      data: { user: "admin", password }
    });
    assert.equal(login.status(), 200);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.url().includes("/api/ds/query") && r.status() >= 400)
        errors.push(`Datasource HTTP ${r.status()}`);
    });
    for (const uid of [
      "meridian-operations",
      "meridian-trading-risk",
      "meridian-pnl-risk",
      "meridian-containers"
    ]) {
      const response = await context.request.get(`${grafanaUrl}/api/dashboards/uid/${uid}`);
      assert.equal(response.status(), 200);
      const savedDashboard = await response.json();
      assert(savedDashboard.meta.provisioned);
      for (const panel of savedDashboard.dashboard.panels)
        for (const target of panel.targets) await query(target.expr);
      await page.goto(`${grafanaUrl}${savedDashboard.meta.url}`, { waitUntil: "domcontentloaded" });
      await page.getByText(savedDashboard.dashboard.title, { exact: true }).first().waitFor();
      await page.waitForTimeout(4000);
      await page.screenshot({ path: path.join(output, `${uid}.png`), fullPage: true });
      dashboardEvidence.push({ uid, panels: savedDashboard.dashboard.panels.length });
    }
    assert.deepEqual(errors, []);
    await context.close();
    await browser.close();
    browser = undefined;
    checks.push(
      "All four provisioned Grafana dashboards render and every panel PromQL query succeeds against real container metrics"
    );
    async function notificationStats() {
      const text = await (await request(`${alertUrl}/metrics`)).text();
      const sum = (name) =>
        [
          ...text.matchAll(
            new RegExp(`^${name}\\{[^\\n]*integration="telegram"[^\\n]*\\} ([0-9.e+]+)$`, "gm")
          )
        ].reduce((n, m) => n + Number(m[1]), 0);
      return {
        sent: sum("alertmanager_notifications_total"),
        failed: sum("alertmanager_notifications_failed_total")
      };
    }
    const initial = await notificationStats();
    assert.equal(initial.sent, 0, "Unrelated fixture alerts must not be delivered");
    console.log(
      "Grafana/scrapes passed; checking actual Redis-outage firing/resolved Telegram delivery..."
    );
    docker("stop", "--time", "5", redis);
    await wait(
      async () =>
        (await query('meridian_dependency_available{dependency="redis"}'))[0]?.value[1] === "0",
      45000
    );
    await wait(
      async () =>
        (await query('ALERTS{alertname="MeridianDependencyUnavailable",alertstate="firing"}'))
          .length > 0,
      100000
    );
    await wait(async () => {
      const s = await notificationStats();
      assert.equal(s.failed, 0);
      return s.sent >= 1;
    }, 90000);
    docker("start", redis);
    await wait(
      async () =>
        (await query('meridian_dependency_available{dependency="redis"}'))[0]?.value[1] === "1",
      60000
    );
    await wait(
      async () =>
        (await query('ALERTS{alertname="MeridianDependencyUnavailable",alertstate="firing"}'))
          .length === 0,
      60000
    );
    await wait(async () => {
      const s = await notificationStats();
      assert.equal(s.failed, 0);
      return s.sent >= 2;
    }, 90000);
    sent = (await notificationStats()).sent;
    assert.equal(sent, 2);
    checks.push(
      "Actual container Redis outage -> production Prometheus rule -> isolated Alertmanager -> two Telegram API-accepted firing/resolved notifications, zero failures"
    );
  } catch (error) {
    failure = error;
    for (const name of owned.filter((name) => !name.endsWith("-alertmanager"))) {
      try {
        await fs.writeFile(path.join(output, `${name}-runtime.log`), docker("logs", name));
      } catch {
        /* Never collect private Alertmanager logs or config. */
      }
    }
    await fs.writeFile(
      path.join(output, "failure.json"),
      JSON.stringify({
        passed: false,
        checks,
        reason: ["AssertionError", "TypeError"].includes(error.name) ? error.message : error.name,
        stage: checks.length
      })
    );
  } finally {
    await browser?.close().catch(() => {});
    for (const name of owned.reverse()) {
      try {
        assert.equal(inspect(name).Config.Labels["meridian.observability-verification"], id);
        docker("rm", "-f", "-v", name);
      } catch (error) {
        failure ??= error;
      }
    }
    for (const name of networks.reverse()) {
      try {
        assert.equal(
          JSON.parse(docker("network", "inspect", name))[0].Labels[
            "meridian.observability-verification"
          ],
          id
        );
        docker("network", "rm", name);
      } catch (error) {
        failure ??= error;
      }
    }
    await fs.unlink(secretFile).catch((error) => {
      if (error.code !== "ENOENT") failure ??= error;
    });
  }
  const result = {
    passed: !failure,
    checks,
    imageEvidence,
    dashboards: dashboardEvidence,
    telegramAccepted: sent,
    scope:
      "Actual isolated API/feed/Web images and storage; no live exchange or trading-loop activation; Telegram API acceptance not read receipt",
    cleanup:
      !docker("ps", "-aq", "--filter", `label=${label}`) &&
      !docker("network", "ls", "-q", "--filter", `label=${label}`)
  };
  await fs.writeFile(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, output: path.relative(root, output) }, null, 2));
  if (failure) {
    console.error("Container observability verification failed; credentials withheld.");
    process.exitCode = 1;
  }
}
main().catch(() => {
  console.error("Container observability setup failed; credentials withheld.");
  process.exitCode = 1;
});
