/* global __dirname */
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { setTimeout: sleep } = require("node:timers/promises");
const root = path.resolve(__dirname, "..");
const id = randomUUID().replaceAll("-", "");
const label = `meridian.container-verification=${id}`;
const network = `meridian-images-${id}`;
const owned = [];
const services = ["api", "ingestor", "engine", "executor", "backtest-worker", "web"];
const checks = [];
const images = [];
const env = {
  DATABASE_URL: "postgres://fixture:fixture@database:5432/fixture",
  REDIS_URL: "redis://redis:6379",
  JWT_SECRET: "isolated-container-fixture-secret-not-for-deployment",
  API_VIEWER_TOKEN: "isolated-container-viewer-fixture",
  API_ALLOWED_ORIGINS: "https://fixture.invalid",
  API_HOST: "0.0.0.0",
  DIAGNOSTICS_HOST: "0.0.0.0",
  BINANCE_ENV: "testnet"
};
const docker = (...args) =>
  execFileSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 600000,
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
async function wait(check, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      /* Startup is asynchronous. */
    }
    await sleep(300);
  }
  throw new Error("Container verification timed out");
}
function start(key, image, args = [], extra = [], hardened = true) {
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
    ...(hardened
      ? [
          "--read-only",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--tmpfs",
          "/tmp:uid=1000,gid=1000,size=64m",
          "--tmpfs",
          "/app/logs:uid=1000,gid=1000,size=16m"
        ]
      : []),
    ...extra,
    image,
    ...args
  );
  return name;
}
const envArgs = Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
const inspect = (name) => JSON.parse(docker("inspect", name))[0];
const execNode = (name, code) => docker("exec", name, "node", "--input-type=module", "-e", code);
async function main() {
  const output = path.join(root, "logs/verification/phase-5", network);
  await fs.mkdir(output, { recursive: true });
  let created = false;
  let failure;
  try {
    const compose = JSON.parse(
      execFileSync(
        "docker",
        [
          "compose",
          "-f",
          "infra/docker-compose.yml",
          "-f",
          "infra/docker-compose.apps.yml",
          "--profile",
          "*",
          "config",
          "--format",
          "json"
        ],
        {
          cwd: root,
          encoding: "utf8",
          windowsHide: true,
          timeout: 30000,
          env: {
            ...process.env,
            ...env,
            API_OPERATOR_TOKEN: "",
            BINANCE_API_KEY: "",
            BINANCE_API_SECRET: "",
            MERIDIAN_ENABLE_TRADING: "blocked"
          }
        }
      )
    );
    for (const service of ["api", "ingestor", "engine", "executor", "backtest-worker", "web"]) {
      assert.equal(compose.services[service].read_only, true);
      assert(compose.services[service].cap_drop.includes("ALL"));
    }
    assert.deepEqual(compose.services.executor.profiles, ["trading"]);
    assert.equal(compose.services.executor.environment.MERIDIAN_ENABLE_TRADING, "blocked");
    checks.push(
      "Compose overlay validates with read-only roots, dropped capabilities and opt-in blocked trading"
    );
    for (const service of services) {
      const image = `meridian/${service}:local`;
      if (!process.argv.includes("--skip-build")) {
        console.log(`Building ${service}...`);
        const args =
          service === "web"
            ? ["build", "-f", "infra/containers/Dockerfile.web", "-t", image, "."]
            : [
                "build",
                "-f",
                "infra/containers/Dockerfile.node",
                "--build-arg",
                `SERVICE=${service}`,
                "--target",
                service === "backtest-worker" ? "cli" : "service",
                "-t",
                image,
                "."
              ];
        await fs.writeFile(path.join(output, `${service}-build.log`), docker(...args));
      }
      const metadata = JSON.parse(docker("image", "inspect", image))[0];
      assert(metadata.Config.User && !["root", "0", "0:0"].includes(metadata.Config.User));
      assert(
        metadata.Size < 512 * 1024 * 1024,
        "Image exceeds sanity ceiling, not a latency target"
      );
      images.push({
        service,
        imageId: metadata.Id,
        bytes: metadata.Size,
        user: metadata.Config.User
      });
      if (service !== "web") {
        const audit = docker(
          "run",
          "--rm",
          "--label",
          label,
          "--network",
          "none",
          "--entrypoint",
          "node",
          image,
          "--input-type=module",
          "-e",
          `
          import assert from 'node:assert/strict'; import fs from 'node:fs';
          import {createRequire} from 'node:module'; const r=createRequire(import.meta.url);
          assert(process.getuid() !== 0);
          for (const p of ['vitest','typescript','tsx','testcontainers','eslint'])
            assert.throws(()=>r.resolve(p));
          for (const p of ['.env','.git','src','pnpm-lock.yaml']) assert(!fs.existsSync(p),p);
          function scan(dir) { for(const e of fs.readdirSync(dir,{withFileTypes:true})) {
            assert(!/\\.(test|spec)\\./.test(e.name),e.name);
            assert(!e.name.startsWith('.env') && !/\\.(pem|key|p12|pfx)$/.test(e.name),e.name);
            if(e.isDirectory()) scan(dir+'/'+e.name);
          }}
          scan('dist');
          for(const p of Object.keys(JSON.parse(fs.readFileSync('package.json')).dependencies||{}))
            if(p.startsWith('@meridian/')) {const entry=r.resolve(p);scan(entry.slice(0,entry.lastIndexOf('/')));}
          console.log('non-root; production dependencies; workspace artifacts clean');`
        );
        assert(audit.includes("artifacts clean"));
      }
    }
    checks.push(
      "Six built images: non-root users, production-only dependencies, clean workspace artifacts, size ceiling"
    );
    const guards = docker(
      "run",
      "--rm",
      "--label",
      label,
      "--network",
      "none",
      "--read-only",
      "--tmpfs",
      "/tmp:uid=1000,gid=1000,size=16m",
      ...["entrypoint.mjs", "entrypoint.test.mjs"].flatMap((file) => [
        "--mount",
        `type=bind,source=${path.join(root, "scripts/containers", file)},target=/tests/${file},readonly`
      ]),
      "--entrypoint",
      "node",
      "meridian/api:local",
      "--test",
      "/tests/entrypoint.test.mjs"
    );
    assert.match(guards, /# pass 8/);
    await fs.writeFile(path.join(output, "linux-entrypoint-tests.log"), guards);
    checks.push(
      "Eight credential-free Linux entrypoint tests, including abrupt child signal exit 143 rather than false success"
    );
    docker("network", "create", "--internal", "--label", label, network);
    created = true;
    const redis = start(
      "redis",
      "redis:7-alpine",
      ["redis-server", "--appendonly", "yes"],
      [],
      false
    );
    const db = start(
      "database",
      "timescale/timescaledb:latest-pg16",
      [],
      [
        "-e",
        "POSTGRES_USER=fixture",
        "-e",
        "POSTGRES_PASSWORD=fixture",
        "-e",
        "POSTGRES_DB=fixture"
      ],
      false
    );
    await wait(() => docker("exec", redis, "redis-cli", "ping") === "PONG");
    await wait(() => {
      docker("exec", db, "pg_isready", "-h", "127.0.0.1", "-U", "fixture");
      return true;
    });
    const backtest = start("backtest", "meridian/backtest-worker:local", ["list"], envArgs);
    await wait(() => !inspect(backtest).State.Running);
    assert.equal(inspect(backtest).State.ExitCode, 0, docker("logs", backtest));
    checks.push(
      "Backtest CLI image applies migrations on disposable Timescale and lists results with exit 0"
    );
    for (const service of ["engine", "executor"]) {
      for (const production of [false, true]) {
        const name = start(
          `${service}-${production}`,
          `meridian/${service}:local`,
          [],
          [
            ...envArgs,
            ...(production
              ? ["-e", "BINANCE_ENV=production", "-e", "MERIDIAN_ENABLE_TRADING=testnet-confirmed"]
              : [])
          ]
        );
        await wait(() => !inspect(name).State.Running);
        assert.equal(inspect(name).State.ExitCode, 78);
      }
    }
    checks.push(
      "Engine and Executor refuse unconfirmed startup and production environment before client creation"
    );
    const api = start("api", "meridian/api:local", [], envArgs);
    await wait(() => inspect(api).State.Health?.Status === "healthy");
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
      ],
      false
    );
    await wait(() => inspect(web).State.Health?.Status === "healthy");
    execNode(
      api,
      `
      import assert from 'node:assert/strict';
      const response=await fetch('http://web:8080/');assert.equal(response.status,200);
      const html=await response.text();const asset=html.match(/src="([^" ]+\\.js)"/)[1];
      assert.equal((await fetch('http://web:8080'+asset)).status,200);
      assert.equal((await fetch('http://web:8080/assets/missing.js')).status,404);
      const headers={authorization:'Bearer '+process.env.API_VIEWER_TOKEN};
      assert.equal((await fetch('http://web:8080/api/system/health')).status,401);
      const health=await fetch('http://web:8080/api/system/health',{headers});assert.equal(health.status,200);
      const sample=await health.json();assert.equal(sample.redis,'available');assert.equal(sample.database,'available');
      const stream=await fetch('http://web:8080/api/stream/account',{headers,signal:AbortSignal.timeout(6000)});
      assert.equal(stream.status,200);assert(stream.headers.get('content-type').includes('text/event-stream'));
      const reader=stream.body.getReader();assert((await reader.read()).value.length>0);await reader.cancel();
    `
    );
    checks.push(
      "API and Web readiness; real static assets; authenticated API proxy and unbuffered account SSE"
    );
    // Actual packaged child process must load workspace exports without dev tooling.
    execNode(
      api,
      `
      import {spawnSync} from 'node:child_process';import assert from 'node:assert/strict';
      const child=spawnSync(process.execPath,['dist/features/backtests/job-process.js','missing-job','fixture-token'],{env:process.env,encoding:'utf8',timeout:10000});
      assert.equal(child.status,1);assert(!/MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/.test(child.stderr));
    `
    );
    checks.push(
      "Packaged API backtest subprocess loads and fails closed for absent claim (not a successful simulation)"
    );
    const ingestor = start("ingestor", "meridian/ingestor:local", [], envArgs);
    await wait(
      () =>
        execNode(
          ingestor,
          `const r=await fetch('http://127.0.0.1:9401/health/live');if(!r.ok)process.exit(1);`
        ) === ""
    );
    execNode(
      ingestor,
      `const r=await fetch('http://127.0.0.1:9401/health/ready');if(r.status!==503)process.exit(1);`
    );
    checks.push(
      "Actual public-feed image starts non-root; isolated upstream unavailable correctly returns readiness 503"
    );
    for (const name of [ingestor, api, web]) {
      docker("kill", "--signal", "SIGTERM", name);
      await wait(() => !inspect(name).State.Running, 20000);
      assert.equal(inspect(name).State.ExitCode, 0, docker("logs", name));
    }
    checks.push(
      "API, Ingestor and Web SIGTERM exit 0 on read-only roots with dropped capabilities"
    );
  } catch (error) {
    failure = error;
    await fs.writeFile(path.join(output, "failure.txt"), String(error));
    for (const name of owned) {
      try {
        await fs.writeFile(path.join(output, `${name}-runtime.log`), docker("logs", name));
      } catch {
        /* Container may not exist. */
      }
    }
  } finally {
    for (const name of owned.reverse()) {
      try {
        const container = inspect(name);
        assert.equal(container.Config.Labels["meridian.container-verification"], id);
        docker("rm", "-f", "-v", name);
      } catch (error) {
        if (!String(error).includes("No such")) failure ??= error;
      }
    }
    if (created) {
      try {
        const metadata = JSON.parse(docker("network", "inspect", network))[0];
        assert.equal(metadata.Labels["meridian.container-verification"], id);
        docker("network", "rm", network);
      } catch (error) {
        failure ??= error;
      }
    }
  }
  const result = {
    passed: !failure,
    checks,
    images,
    scope: "Isolated image verification, not HTTPS deployment or live trading",
    cleanup: !created || !docker("network", "ls", "--filter", `label=${label}`, "-q")
  };
  await fs.writeFile(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, artifact: path.relative(root, output) }, null, 2));
  if (failure) throw failure;
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
