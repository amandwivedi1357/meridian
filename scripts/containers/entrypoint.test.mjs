import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { URL } from "node:url";

async function fixture(service, env = {}, source = "process.exit(0)") {
  const prefix = path.join(tmpdir(), "meridian-container-test-");
  const root = await mkdtemp(prefix);
  try {
    await mkdir(path.join(root, "container"));
    await mkdir(path.join(root, "dist"));
    await copyFile(
      new URL("./entrypoint.mjs", import.meta.url),
      path.join(root, "container/entrypoint.mjs")
    );
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: `@meridian/${service}`, type: "module" })
    );
    await writeFile(
      path.join(root, "dist", service === "ingestor" ? "dashboard-feed.js" : "main.js"),
      source
    );
    return spawnSync(process.execPath, ["container/entrypoint.mjs"], {
      cwd: root,
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
      env: { ...process.env, MERIDIAN_ENABLE_TRADING: "blocked", BINANCE_ENV: "testnet", ...env }
    });
  } finally {
    assert(path.resolve(root).startsWith(path.resolve(prefix)));
    await rm(root, { recursive: true, force: true });
  }
}
for (const service of ["engine", "executor"]) {
  test(`${service} cannot bypass confirmation by overriding a service environment variable`, async () => {
    const result = await fixture(service, { MERIDIAN_SERVICE: "api" });
    assert.equal(result.status, 78);
    assert.match(result.stderr, /explicit Testnet confirmation/);
  });
  test(`${service} refuses production even with confirmation`, async () => {
    assert.equal(
      (
        await fixture(service, {
          MERIDIAN_ENABLE_TRADING: "testnet-confirmed",
          BINANCE_ENV: "production"
        })
      ).status,
      78
    );
  });
}
test("confirmed Testnet launches only the fixture child", async () => {
  assert.equal(
    (await fixture("executor", { MERIDIAN_ENABLE_TRADING: "testnet-confirmed" })).status,
    0
  );
});
test("child failure exit code is preserved", async () => {
  assert.equal((await fixture("api", {}, "process.exit(7)")).status, 7);
});
test("Ingestor launches its continuous-feed entrypoint", async () => {
  assert.equal((await fixture("ingestor")).status, 0);
});
test(
  "signal-killed child is not reported as graceful",
  { skip: process.platform === "win32" },
  async () => {
    assert.equal((await fixture("api", {}, "process.kill(process.pid, 'SIGTERM')")).status, 143);
  }
);
