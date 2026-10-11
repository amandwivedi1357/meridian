/* global __dirname */
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { setTimeout: sleep } = require("node:timers/promises");
const root = path.resolve(__dirname, "..");
const id = randomUUID().replaceAll("-", "");
const network = `meridian-chaos-${id}`;
const names = {
  redis: `${network}-redis`,
  database: `${network}-db`,
  runtime: `${network}-runtime`
};
const owned = [];
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000,
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
async function wait(check, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      /* Temporary unavailability is expected during fault injection. */
    }
    await sleep(200);
  }
  throw new Error("Isolated chaos check timed out");
}
async function main() {
  const output = path.join(root, "logs/verification/phase-5/chaos");
  await fs.mkdir(output, { recursive: true });
  const esbuild = require(
    path.join(root, "node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild")
  );
  await esbuild.build({
    entryPoints: [path.join(root, "scripts/chaos/runtime-fixture.mjs")],
    outfile: path.join(output, "fixture.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["pg-native"],
    logLevel: "silent"
  });
  for (const [name, entry] of [
    ["backtest", "apps/backtest-worker/src/main.ts"],
    ["ingestor", "apps/ingestor/src/main.ts"],
    ["api", "apps/api/src/main.ts"],
    ["job", "apps/api/src/features/backtests/job-process.ts"]
  ]) {
    await esbuild.build({
      entryPoints: [path.join(root, entry)],
      outfile: path.join(output, `${name}.mjs`),
      bundle: true,
      platform: "node",
      format: "esm",
      external: ["pg-native"],
      banner: {
        js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);'
      },
      logLevel: "silent"
    });
  }
  const checks = [];
  let result;
  let networkCreated = false;
  try {
    docker("network", "create", "--internal", "--label", `meridian.chaos=${id}`, network);
    networkCreated = true;
    for (const [key, image, args] of [
      ["redis", "redis:7-alpine", ["redis-server", "--appendonly", "yes"]],
      [
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
        ]
      ]
    ]) {
      owned.push(names[key]);
      docker(
        "run",
        "-d",
        "--name",
        names[key],
        "--label",
        `meridian.chaos=${id}`,
        "--network",
        network,
        "--network-alias",
        key,
        ...(key === "database"
          ? [
              "-e",
              "POSTGRES_USER=fixture",
              "-e",
              "POSTGRES_PASSWORD=fixture",
              "-e",
              "POSTGRES_DB=fixture"
            ]
          : []),
        image,
        ...args
      );
    }
    await wait(() => docker("exec", names.redis, "redis-cli", "ping") === "PONG");
    await wait(() => {
      docker("exec", names.database, "pg_isready", "-h", "127.0.0.1", "-U", "fixture");
      return true;
    }, 90000);
    async function start() {
      owned.push(names.runtime);
      // Mount only the generated credential-free bundle, never .env or the checkout.
      docker(
        "run",
        "-d",
        "--name",
        names.runtime,
        "--label",
        `meridian.chaos=${id}`,
        "--network",
        network,
        "--mount",
        `type=bind,source=${output},target=/fixture,readonly`,
        "node:22-alpine",
        "node",
        "/fixture/fixture.cjs"
      );
      const request = (port, route, method = "GET") =>
        JSON.parse(
          docker(
            "exec",
            names.runtime,
            "node",
            "-e",
            `fetch('http://127.0.0.1:${port}${route}',{method:'${method}',signal:AbortSignal.timeout(30000)}).then(async r=>console.log(JSON.stringify({status:r.status,body:await r.json()}))).catch(()=>process.exit(1))`
          )
        );
      const readiness = () => request(8080, "/health/ready").status;
      await wait(() => readiness() === 200);
      return {
        readiness,
        async post(route) {
          const r = request(8081, route, "POST");
          assert.equal(r.status, 200, JSON.stringify(r.body));
          return r.body;
        }
      };
    }
    let runtime = await start();
    const cli = await runtime.post("/cli");
    assert.equal(cli.results.length, 4);
    for (const result of cli.results) {
      assert.equal(result.code, 1);
      assert.equal(result.signal, null);
      assert.equal(result.cancelled, true, result.name);
      assert.ok(result.elapsedMs < 10000);
    }
    checks.push(
      "actual API/backtest/ingestor startup and backtest job SIGTERM cancel with bounded cleanup"
    );
    assert.deepEqual(await runtime.post("/risk"), { blocked: false, durable: false });
    const events = await runtime.post("/events");
    assert.equal(events.fills, 1);
    assert.equal(events.order.state, "FILLED");
    assert.equal(events.order.executed_quantity, "1");
    checks.push("duplicate fill deduplication and older order update cannot regress FILLED");
    docker("network", "disconnect", network, names.redis);
    await wait(() => runtime.readiness() === 503);
    assert.deepEqual(await runtime.post("/risk"), { blocked: true, durable: true });
    docker("network", "connect", "--alias", "redis", network, names.redis);
    await wait(() => runtime.readiness() === 200);
    assert.deepEqual(await runtime.post("/risk"), { blocked: true, durable: true });
    checks.push("Redis network cut degrades readiness and durable kill survives recovery");
    docker("kill", names.redis);
    await wait(() => runtime.readiness() === 503);
    assert.equal((await runtime.post("/risk")).blocked, true);
    docker("start", names.redis);
    await wait(() => runtime.readiness() === 200);
    checks.push("Redis process kill/restart stays fail-closed");
    docker("kill", names.runtime);
    docker("rm", names.runtime);
    runtime = await start();
    assert.deepEqual(await runtime.post("/risk"), { blocked: true, durable: true });
    checks.push("fixture executor safety crash/restart does not clear durable kill");
    docker("kill", "--signal", "TERM", names.runtime);
    await wait(() => docker("inspect", "-f", "{{.State.Running}}", names.runtime) === "false");
    assert.equal(docker("inspect", "-f", "{{.State.ExitCode}}", names.runtime), "0");
    assert.ok(docker("logs", names.runtime).includes('"drained":true'));
    assert.ok(docker("logs", names.runtime).includes('"drainingReady":false'));
    checks.push("actual Linux SIGTERM drains and exits zero");
    docker("rm", names.runtime);
    runtime = await start();
    await runtime.post("/hang");
    const started = Date.now();
    docker("kill", "--signal", "TERM", names.runtime);
    await wait(
      () => docker("inspect", "-f", "{{.State.Running}}", names.runtime) === "false",
      10000
    );
    assert.equal(docker("inspect", "-f", "{{.State.ExitCode}}", names.runtime), "1");
    const forcedExitMs = Date.now() - started;
    assert.ok(forcedExitMs < 10000);
    checks.push("hung drain exits nonzero within bounded shutdown deadline");
    result = {
      success: true,
      checks,
      forcedExitMs,
      scope:
        "Real isolated Redis/Postgres and production diagnostics/kill/order repositories; runtime fixture, not deployed service acceptance or real exchange trading",
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    let fixtureLog = "";
    let databaseLog = "";
    try {
      databaseLog = docker("logs", names.database).slice(-5000);
    } catch {
      /* May not exist. */
    }
    try {
      fixtureLog = docker("logs", names.runtime).slice(-5000);
    } catch {
      /* Startup failures may leave no runtime container log. */
    }
    await fs.writeFile(
      path.join(output, "failure.json"),
      JSON.stringify(
        { success: false, checks, message: error.message, fixtureLog, databaseLog },
        null,
        2
      )
    );
    throw error;
  } finally {
    const cleanupErrors = [];
    for (const name of [...new Set(owned)].reverse()) {
      try {
        if (!docker("ps", "-a", "--filter", `name=^/${name}$`, "--format", "{{.ID}}")) continue;
        assert.equal(
          docker("inspect", "-f", '{{index .Config.Labels "meridian.chaos"}}', name),
          id
        );
        docker("rm", "-f", "-v", name);
      } catch {
        cleanupErrors.push(name);
      }
    }
    if (networkCreated) {
      try {
        assert.equal(
          docker("network", "inspect", "-f", '{{index .Labels "meridian.chaos"}}', network),
          id
        );
        docker("network", "rm", network);
      } catch {
        cleanupErrors.push(network);
      }
    }
    assert.equal(
      cleanupErrors.length,
      0,
      `Test resource cleanup failed: ${cleanupErrors.join(", ")}`
    );
  }
  result.cleanupComplete = true;
  await fs.writeFile(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
main().catch((error) => {
  console.error("Isolated chaos verification failed:", error.message);
  process.exitCode = 1;
});
