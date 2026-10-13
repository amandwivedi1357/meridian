/* global __dirname */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { setTimeout: sleep } = require("node:timers/promises");
const { createLocalBackupController, issueFor } = require("./local-backup.cjs");
const root = path.resolve(__dirname, "..");
const { fetch, AbortSignal } = globalThis;
const api = '{job="meridian-api"}';
const feed = '{job="meridian-ingestor"}';
const expressions = {
  dependencies: `meridian_dependency_available${api}`,
  storageAge: `time() - meridian_storage_sample_timestamp_seconds${api}`,
  ledger: `meridian_ledger_sample_available${api}`,
  ledgerAge: `time() - meridian_ledger_sample_timestamp_seconds${api}`,
  dispatcher: `meridian_backtest_dispatcher_ready${api}`,
  connections: `meridian_market_connections${feed}`,
  connectionReady: `meridian_market_connection_ready${feed}`,
  connectionAge: `meridian_market_connection_age_seconds${feed}`,
  feedAge: `ws_last_message_age_seconds${feed}`,
  busSamples: `sum(ingest_to_bus_latency_ms_count${feed})`,
  persisted: `sum(ingestor_events_persisted_total${feed})`,
  scrapeAge: `time() - timestamp(up{job=~"meridian-(api|ingestor)"})`
};
function value(row) {
  assert.ok(row?.value && row.value[1] !== "", "Missing metric value");
  const number = Number(row.value[1]);
  assert.ok(Number.isFinite(number), "Nonfinite metric");
  return number;
}
function one(rows) {
  assert.equal(rows.length, 1, "Expected one metric series");
  return value(rows[0]);
}
function validateLocalMetrics(data) {
  assert.equal(data.dependencies.length, 2);
  assert.deepEqual(data.dependencies.map((row) => row.metric.dependency).sort(), [
    "redis",
    "timescaledb"
  ]);
  assert.ok(data.dependencies.every((row) => value(row) === 1));
  for (const key of ["storageAge", "ledgerAge"])
    assert.ok(one(data[key]) >= 0 && one(data[key]) <= 45, `${key} stale`);
  assert.equal(one(data.ledger), 1);
  assert.equal(one(data.dispatcher), 1);
  assert.equal(data.scrapeAge.length, 2);
  assert.ok(data.scrapeAge.every((row) => value(row) >= 0 && value(row) <= 45));
  const count = one(data.connections);
  assert.ok(Number.isSafeInteger(count) && count >= 1 && count <= 4);
  assert.equal(data.connectionReady.length, count);
  assert.equal(data.connectionAge.length, count);
  const symbols = data.connectionReady.map((row) => row.metric.symbol).sort();
  assert.equal(new Set(symbols).size, count);
  assert.ok(symbols.includes("BTCUSDT"));
  assert.ok(symbols.every((symbol) => /^[A-Z0-9]{3,30}$/.test(symbol)));
  assert.deepEqual(data.connectionAge.map((row) => row.metric.symbol).sort(), symbols);
  assert.ok(data.connectionReady.every((row) => value(row) === 1));
  assert.ok(data.connectionAge.every((row) => value(row) >= 0 && value(row) <= 15));
  assert.ok(one(data.feedAge) >= 0 && one(data.feedAge) <= 15);
  assert.ok(one(data.busSamples) > 0, "No successful bus publication sample");
  assert.ok(one(data.persisted) > 0, "No persisted market data");
  return {
    activeSymbols: symbols,
    dependencies: ["redis", "timescaledb"],
    activeConnections: count
  };
}
async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, "Local health endpoint unavailable");
  return response.json();
}
async function main() {
  const output = path.join(root, "logs/verification/phase-5/local-health.json");
  const deadline = Date.now() + 90000;
  let summary, data, rules, targets;
  while (Date.now() < deadline) {
    try {
      for (const port of [9400, 9401]) {
        await json(`http://127.0.0.1:${port}/health/live`);
        await json(`http://127.0.0.1:${port}/health/ready`);
      }
      const web = await fetch("http://127.0.0.1:5173/", { signal: AbortSignal.timeout(5000) });
      assert.equal(web.status, 200, "Local Web unavailable");
      await web.text();
      targets = (await json("http://127.0.0.1:9090/api/v1/targets")).data.activeTargets;
      for (const job of ["meridian-api", "meridian-ingestor"]) {
        const active = targets.filter((target) => target.labels.job === job);
        assert.equal(active.length, 1);
        assert.equal(active[0].health, "up");
      }
      data = {};
      for (const [key, expression] of Object.entries(expressions)) {
        const response = await json(
          `http://127.0.0.1:9090/api/v1/query?query=${encodeURIComponent(expression)}`
        );
        assert.equal(response.status, "success");
        assert.equal(response.data.resultType, "vector");
        data[key] = response.data.result;
      }
      summary = validateLocalMetrics(data);
      rules = (await json("http://127.0.0.1:9090/api/v1/rules")).data.groups
        .flatMap((group) => group.rules)
        .filter((rule) => rule.name.startsWith("Meridian"));
      assert.ok(rules.length >= 16 && rules.every((rule) => rule.health === "ok"));
      break;
    } catch (error) {
      summary = undefined;
      if (Date.now() + 2000 >= deadline) throw error;
      await sleep(2000);
    }
  }
  assert.ok(summary, "Local health did not converge before deadline");
  const backup = await createLocalBackupController().status();
  assert.equal(backup.lastAttemptStatus, "verified");
  assert.equal(backup.lastBackupAvailable, true);
  assert.equal(issueFor(backup, Date.now()), null, "Backup due-window protection unhealthy");
  const result = {
    ok: true,
    checkedAt: new Date().toISOString(),
    ...summary,
    diagnostics: "API/feed live+ready 200; Web 200",
    evaluatedRules: rules.length,
    tradingTargets: targets
      .filter((target) => ["meridian-engine", "meridian-executor"].includes(target.labels.job))
      .map((target) => ({
        job: target.labels.job,
        scrape: target.health,
        permissionToTrade: "not-verified"
      })),
    backup: { verified: true, available: true, lastSuccessAt: backup.lastSuccessAt },
    metrics: data,
    mutations: 0,
    limitations: [
      "Point-in-time local check, not a soak or performance proof",
      "Engine/Executor not activated; exchange/trading acceptance remains pending"
    ]
  };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      ok: true,
      ...summary,
      evaluatedRules: rules.length,
      backupVerified: true,
      mutations: 0,
      evidence: path.relative(root, output)
    })
  );
}
module.exports = { validateLocalMetrics };
if (require.main === module)
  main().catch((error) => {
    console.error(`Local health verification failed: ${error.message}`);
    process.exitCode = 1;
  });
