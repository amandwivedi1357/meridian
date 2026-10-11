const assert = require("node:assert/strict");
const { test } = require("node:test");
const { containerConfig } = require("./observability-config.cjs");
test("default container targets omit opt-in trading and feed, never substitute host ports", () => {
  const config = containerConfig();
  assert.deepEqual(config.alerting.alertmanagers, []);
  assert(config.scrape_configs.some((s) => s.job_name === "meridian-api"));
  assert(!JSON.stringify(config).includes("host.docker.internal"));
  for (const service of ["engine", "executor", "ingestor", "backtest-worker"]) {
    assert(!JSON.stringify(config).includes(`${service}:`));
  }
  assert.equal(
    config.scrape_configs.find((s) => s.job_name === "meridian-health").static_configs.length,
    4
  );
});
test("explicit profiles add real DNS scrape and both health probes", () => {
  const config = containerConfig(["market", "trading", "jobs", "alerts"]);
  for (const job of [
    "meridian-api",
    "meridian-ingestor",
    "meridian-engine",
    "meridian-executor",
    "alertmanager"
  ]) {
    assert(config.scrape_configs.some((s) => s.job_name === job));
  }
  assert.equal(
    config.scrape_configs.find((s) => s.job_name === "meridian-health").static_configs.length,
    10
  );
  assert(!JSON.stringify(config).includes("backtest-worker:"));
});
test("unknown profile is rejected rather than silently dropping monitoring", () => {
  assert.throws(() => containerConfig(["tradng"]), /Unknown/);
});
