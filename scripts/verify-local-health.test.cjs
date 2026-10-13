const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateLocalMetrics } = require("./verify-local-health.cjs");
const row = (value, metric = {}) => ({ metric, value: [0, String(value)] });
function healthy() {
  return {
    dependencies: [row(1, { dependency: "redis" }), row(1, { dependency: "timescaledb" })],
    storageAge: [row(5)],
    ledgerAge: [row(20)],
    ledger: [row(1)],
    dispatcher: [row(1)],
    connections: [row(1)],
    connectionReady: [row(1, { symbol: "BTCUSDT" })],
    connectionAge: [row(0.01, { symbol: "BTCUSDT" })],
    feedAge: [row(0.01)],
    busSamples: [row(100)],
    persisted: [row(100)],
    scrapeAge: [row(5), row(5)]
  };
}
test("healthy local metric snapshot validates observed samples only", () => {
  assert.deepEqual(validateLocalMetrics(healthy()).activeSymbols, ["BTCUSDT"]);
});
test("unknown, stale and unhealthy signals cannot pass", () => {
  for (const key of Object.keys(healthy())) {
    const data = healthy();
    data[key] = [];
    assert.throws(() => validateLocalMetrics(data), key);
  }
  for (const [key, v] of [
    ["storageAge", 46],
    ["ledgerAge", 46],
    ["ledger", 0],
    ["dispatcher", 0],
    ["connections", 5],
    ["feedAge", -1],
    ["busSamples", 0],
    ["persisted", 0]
  ]) {
    const data = healthy();
    data[key] = [row(v)];
    assert.throws(() => validateLocalMetrics(data), key);
  }
});
test("one stalled secondary connection fails even if BTC remains healthy", () => {
  const data = healthy();
  data.connections = [row(2)];
  data.connectionReady.push(row(0, { symbol: "ETHUSDT" }));
  data.connectionAge.push(row(16, { symbol: "ETHUSDT" }));
  assert.throws(() => validateLocalMetrics(data));
  data.connectionReady[1] = row(1, { symbol: "ETHUSDT" });
  data.connectionAge[1] = row(1, { symbol: "ETHUSDT" });
  assert.equal(validateLocalMetrics(data).activeConnections, 2);
  data.connectionAge[1] = row(1, { symbol: "SOLUSDT" });
  assert.throws(() => validateLocalMetrics(data));
});
