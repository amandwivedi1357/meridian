const assert = require("node:assert/strict");
const { test } = require("node:test");
const { summarize } = require("./verify-ingest-ablation.cjs");
test("ablation summary retains failures and separates checkpoint meanings", () => {
  const runs = [1, 2, 3].map((value) => ({
    ablation: "no-db",
    fixturePassed: value !== 3,
    checkpointP95Ms: value,
    checkpointP99Ms: value * 2,
    operationP95Ms: value,
    operationP99Ms: value * 2,
    capacityRefused: value === 3 ? 20 : 0,
    unscheduledEvents: 0
  }));
  runs.push({ ablation: "full", invalid: true });
  const groups = summarize(runs);
  assert.equal(groups["no-db"].complete, true);
  assert.equal(groups["no-db"].allFixtureChecksPass, false);
  assert.deepEqual(groups["no-db"].statistics.checkpointP95Ms, { median: 2, min: 1, max: 3 });
  assert.equal(groups.full.complete, false);
  assert.equal(groups.full.runs.length, 1);
  assert.equal(groups["normalize-only"].statistics, null);
});
