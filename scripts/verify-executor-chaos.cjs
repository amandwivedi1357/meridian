/* global __dirname */
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { setTimeout: sleep } = require("node:timers/promises");
const root = path.resolve(__dirname, "..");

async function main() {
  const id = randomUUID().replaceAll("-", "");
  const network = `meridian-executor-chaos-${id}`;
  const names = Object.fromEntries(
    ["redis", "database", "exchange", "executor"].map((key) => [key, `${network}-${key}`])
  );
  const output = path.join(root, "logs/verification/phase-5", `executor-chaos-${id}`);
  await fs.mkdir(output, { recursive: true });
  const docker = (...args) =>
    execFileSync("docker", args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 120000,
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  const esbuild = require(
    path.join(root, "node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild")
  );
  for (const [name, entry] of [
    ["exchange", "scripts/chaos/executor-exchange-fixture.mjs"],
    ["executor", "scripts/chaos/executor-entry.mjs"]
  ]) {
    await esbuild.build({
      entryPoints: [path.join(root, entry)],
      outfile: path.join(output, `${name}.mjs`),
      bundle: true,
      platform: "node",
      format: "esm",
      external: ["pg-native"],
      logLevel: "silent",
      banner: {
        js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);'
      },
      plugins:
        name === "executor"
          ? [
              {
                name: "isolated-exchange-only",
                setup(build) {
                  build.onResolve({ filter: /^@meridian\/binance-client$/ }, () => ({
                    path: path.join(root, "scripts/chaos/executor-exchange-adapter.mjs")
                  }));
                }
              }
            ]
          : []
    });
  }
  const checks = [];
  const owned = new Set();
  let networkOwned = false;
  let result;
  async function wait(check, description, timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
      try {
        if (await check()) return;
      } catch (error) {
        lastError = error.message;
      }
      await sleep(250);
    }
    throw new Error(`Timeout: ${description}${lastError ? ` (${lastError})` : ""}`);
  }
  const request = (host, port, route, method = "GET") =>
    JSON.parse(
      docker(
        "exec",
        names.exchange,
        "node",
        "-e",
        `fetch(${JSON.stringify(`http://${host}:${port}${route}`)},{method:${JSON.stringify(method)},signal:AbortSignal.timeout(4000)}).then(async r=>console.log(JSON.stringify({status:r.status,body:await r.json()}))).catch(()=>process.exit(1))`
      )
    );
  const control = (route, method = "POST") => {
    const reply = request("127.0.0.1", 8082, `/control/${route}`, method);
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    return reply.body;
  };
  const state = () => control("state", "GET");
  const ready = () => request("executor", 9403, "/health/ready").status;
  const startExecutor = () => {
    owned.add(names.executor);
    docker(
      "run",
      "-d",
      "--name",
      names.executor,
      "--label",
      `meridian.executor-chaos=${id}`,
      "--network",
      network,
      "--network-alias",
      "executor",
      "--mount",
      `type=bind,source=${output},target=/fixture,readonly`,
      "-e",
      "DATABASE_URL=postgres://fixture:fixture@database:5432/fixture",
      "-e",
      "REDIS_URL=redis://redis:6379",
      "-e",
      "JWT_SECRET=isolated-executor-chaos-only",
      "-e",
      "EXECUTOR_MAX_OPEN_ORDERS=2",
      "-e",
      "DIAGNOSTICS_HOST=0.0.0.0",
      "-e",
      "SHUTDOWN_TIMEOUT_MS=5000",
      "node:22-alpine",
      "node",
      "/fixture/executor.mjs"
    );
  };
  try {
    docker("network", "create", "--internal", "--label", `meridian.executor-chaos=${id}`, network);
    networkOwned = true;
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
      ],
      ["exchange", "node:22-alpine", ["node", "/fixture/exchange.mjs"]]
    ]) {
      owned.add(names[key]);
      docker(
        "run",
        "-d",
        "--name",
        names[key],
        "--label",
        `meridian.executor-chaos=${id}`,
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
        ...(key === "exchange"
          ? ["--mount", `type=bind,source=${output},target=/fixture,readonly`]
          : []),
        image,
        ...args
      );
      if (key === "redis")
        await wait(
          () => docker("exec", names.redis, "redis-cli", "ping") === "PONG",
          "Redis startup"
        );
      if (key === "database")
        await wait(
          () => {
            docker("exec", names.database, "pg_isready", "-h", "127.0.0.1", "-U", "fixture");
            return true;
          },
          "database startup",
          90000
        );
    }
    await wait(() => state().kill === false, "fixture initialization");
    startExecutor();
    await wait(() => ready() === 200, "actual Executor readiness");
    checks.push(
      "actual Executor startup, signed REST/user-data subscription, reconciliation and polling ready"
    );
    control("signal?key=duplicate");
    await wait(() => state().orders[0]?.state === "NEW", "first simulated order persisted");
    control("signal?key=duplicate");
    await wait(() => state().pending?.[0] === 0, "duplicate signal acknowledged");
    assert.equal(state().totalSends, 1);
    checks.push(
      "duplicate signal consumed by actual loop sends one order only, durable claim observed before HTTP send"
    );
    control("fill");
    await wait(() => {
      const s = state();
      return s.fills === 1 && s.orders[0]?.state === "FILLED";
    }, "duplicate/older user-data persistence");
    assert.equal(state().orders[0].executed_quantity, "0.0001");
    checks.push("real WebSocket duplicate fills deduplicate and older NEW cannot regress FILLED");
    control("hold?enabled=true");
    control("signal?key=crash-after-send");
    await wait(() => {
      const s = state();
      return (
        s.totalSends === 2 &&
        s.held === 1 &&
        s.pending?.[0] === 1 &&
        s.orders.some((order) => order.state === "UNKNOWN")
      );
    }, "held exchange acknowledgement");
    docker("kill", "--signal", "KILL", names.executor);
    assert.equal(docker("inspect", "-f", "{{.State.ExitCode}}", names.executor), "137");
    control("hold?enabled=false");
    docker("rm", names.executor);
    startExecutor();
    await wait(() => ready() === 200, "Executor recovery startup");
    await wait(() => state().pending?.[0] === 0, "stale signal recovery without resend", 65000);
    assert.equal(state().totalSends, 2);
    assert.ok(state().exchange.every((order) => order.sends === 1));
    checks.push(
      "actual Executor SIGKILL after exchange accept/before ACK recovers pending signal without duplicate submission"
    );
    docker("network", "disconnect", network, names.redis);
    await wait(() => ready() === 503, "readiness after Redis cut");
    await wait(
      () => state().kill && state().cancellations >= 1,
      "durable fail-closed latch and cancellation"
    );
    docker("network", "connect", "--alias", "redis", network, names.redis);
    await wait(() => ready() === 200, "readiness after Redis restore");
    const rejectedBefore = state().rejections;
    control("signal?key=blocked-after-redis");
    await wait(
      () => state().rejections > rejectedBefore && state().pending?.[0] === 0,
      "blocked signal after recovery"
    );
    assert.equal(state().totalSends, 2);
    assert.equal(state().kill, true);
    checks.push(
      "Redis network cut drops readiness, latches durable kill, cancels simulated open order and stays blocked after recovery"
    );
    docker("kill", names.redis);
    await wait(() => ready() === 503, "readiness after Redis process death");
    docker("start", names.redis);
    await wait(() => ready() === 200, "readiness after Redis restart");
    assert.equal(state().kill, true);
    assert.equal(state().totalSends, 2);
    checks.push("Redis AOF process restart retains fail-closed execution state");
    docker("network", "disconnect", network, names.executor);
    await sleep(1500);
    assert.equal(state().totalSends, 2);
    docker("network", "connect", "--alias", "executor", network, names.executor);
    await wait(() => ready() === 200, "Executor reconnect/reconciliation after network cut", 65000);
    assert.equal(state().kill, true);
    assert.equal(state().totalSends, 2);
    checks.push(
      "actual Executor network isolation/reconnect does not clear kill or issue additional orders"
    );
    const stoppingAt = Date.now();
    docker("kill", "--signal", "TERM", names.executor);
    await wait(
      () => docker("inspect", "-f", "{{.State.Running}}", names.executor) === "false",
      "SIGTERM drain",
      15000
    );
    const shutdownMs = Date.now() - stoppingAt;
    assert.equal(docker("inspect", "-f", "{{.State.ExitCode}}", names.executor), "0");
    assert.ok(docker("logs", names.executor).includes('"msg":"executor stopped"'));
    const final = state();
    assert.equal(final.totalSends, 2);
    assert.equal(final.fills, 1);
    assert.equal(final.writeAheadViolations, 0);
    assert.equal(final.unexpectedRequests, 0);
    checks.push("actual Executor Linux SIGTERM closes tracker/clients/diagnostics and exits zero");
    result = {
      success: true,
      checkedAt: new Date().toISOString(),
      checks,
      final,
      shutdownMs,
      scope:
        "Actual Executor runCliMain/full service loop and production REST/WS/risk/storage components, build-time local exchange adapter, real isolated Redis/Timescale. Not an unmodified deployed image, real Binance/Testnet fault acceptance, host performance or soak."
    };
  } catch (error) {
    const logs = {};
    for (const key of ["executor", "exchange", "database"]) {
      try {
        logs[key] = docker("logs", names[key]).slice(-8000);
      } catch {
        /* Container may not exist yet. */
      }
    }
    await fs.writeFile(
      path.join(output, "failure.json"),
      JSON.stringify({ success: false, checks, error: error.message, logs }, null, 2)
    );
    throw error;
  } finally {
    const failures = [];
    for (const name of [...owned].reverse()) {
      try {
        if (!docker("ps", "-a", "--filter", `name=^/${name}$`, "--format", "{{.ID}}")) continue;
        assert.equal(
          docker("inspect", "-f", '{{index .Config.Labels "meridian.executor-chaos"}}', name),
          id
        );
        docker("rm", "-f", "-v", name);
      } catch {
        failures.push(name);
      }
    }
    if (networkOwned) {
      try {
        assert.equal(
          docker(
            "network",
            "inspect",
            "-f",
            '{{index .Labels "meridian.executor-chaos"}}',
            network
          ),
          id
        );
        docker("network", "rm", network);
      } catch {
        failures.push(network);
      }
    }
    assert.equal(failures.length, 0, `Cleanup failed: ${failures.join(",")}`);
  }
  result.cleanupComplete = true;
  await fs.writeFile(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output, ...result }));
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
