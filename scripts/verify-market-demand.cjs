/* global __dirname */
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs/promises");
const { setTimeout: sleep } = require("node:timers/promises");
async function main() {
  const id = randomUUID();
  const name = `meridian-market-demand-${id}`;
  const label = `meridian.market-demand-test=${id}`;
  const docker = (...args) =>
    execFileSync("docker", args, { encoding: "utf8", windowsHide: true, timeout: 30000 }).trim();
  const contract = await import(
    pathToFileURL(path.resolve(__dirname, "../packages/config/dist/market-demand.js")).href
  );
  let created = false;
  try {
    docker("run", "-d", "--name", name, "--label", label, "--network", "none", "redis:7-alpine");
    created = true;
    for (let i = 0; i < 30; i++) {
      try {
        if (docker("exec", name, "redis-cli", "ping") === "PONG") break;
      } catch {
        /* Startup. */
      }
      await sleep(100);
    }
    const cli = (...args) => docker("exec", name, "redis-cli", "--raw", ...args);
    const claim = (member, symbol) =>
      cli("EVAL", contract.marketDemandScript, "1", contract.marketDemandKey, member, symbol);
    const first = `${randomUUID()}|ETHUSDT`;
    assert.equal(claim(first, "ETHUSDT"), "1");
    assert.equal(claim(`${randomUUID()}|ETHUSDT`, "ETHUSDT"), "1");
    assert.equal(claim(`${randomUUID()}|SOLUSDT`, "SOLUSDT"), "1");
    const third = `${randomUUID()}|BNBUSDT`;
    assert.equal(claim(third, "BNBUSDT"), "1");
    assert.equal(claim(`${randomUUID()}|XRPUSDT`, "XRPUSDT"), "0");
    assert.equal(claim(first, "ETHUSDT"), "1");
    cli("ZREM", contract.marketDemandKey, third);
    assert.equal(claim(`${randomUUID()}|XRPUSDT`, "XRPUSDT"), "1");
    cli("ZADD", contract.marketDemandKey, "0", `${randomUUID()}|STALEUSDT`);
    const members = cli(
      "EVAL",
      contract.readMarketDemandScript,
      "1",
      contract.marketDemandKey
    ).split("\n");
    assert(!members.some((member) => member.endsWith("STALEUSDT")));
    assert.equal(contract.demandedMarketSymbols(members).length, 4);
  } finally {
    if (created) {
      assert.equal(
        JSON.parse(docker("inspect", name))[0].Config.Labels["meridian.market-demand-test"],
        id
      );
      docker("rm", "-f", "-v", name);
    }
  }
  const output = path.resolve(__dirname, "../logs/verification/instruments");
  await fs.mkdir(output, { recursive: true });
  const result = {
    passed: true,
    scope:
      "Real isolated Redis atomic symbol capacity, shared viewers, renewal, release and expired lease pruning; no shared Redis changes",
    cleanup: true
  };
  await fs.writeFile(path.join(output, "demand.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
