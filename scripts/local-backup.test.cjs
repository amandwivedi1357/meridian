/* global __dirname */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { test } = require("node:test");
const {
  latestDueAt,
  issueFor,
  validateState,
  createLocalBackupController,
  fileLock
} = require("./local-backup.cjs");
const { run, verify, parseArgs, pruneLocalBackups } = require("./db-backup.cjs");
const noon = Date.parse("2026-10-12T08:00:00Z");
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meridian-backup-test-"));
  t.after(async () => {
    assert.equal(path.dirname(root), await fs.realpath(os.tmpdir()));
    assert.match(path.basename(root), /^meridian-backup-test-/);
    await fs.rm(root, { recursive: true, force: true });
  });
  let time = noon;
  const messages = [];
  const controller = createLocalBackupController({
    root,
    now: () => time,
    artifactAvailable: async () => true,
    send: async (message) => messages.push(message),
    runBackup: async () => ({
      restoreVerified: true,
      bytes: 5,
      migrationCount: 8,
      backup: "backups/test.dump"
    }),
    ...options
  });
  return {
    controller,
    root,
    messages,
    tick: (ms) => {
      time += ms;
    }
  };
}
test("Dubai due window crosses UTC date and month safely", () => {
  assert.equal(
    new Date(latestDueAt(Date.parse("2026-10-11T22:59:59Z"))).toISOString(),
    "2026-10-10T23:00:00.000Z"
  );
  assert.equal(
    new Date(latestDueAt(Date.parse("2026-10-11T23:00:00Z"))).toISOString(),
    "2026-10-11T23:00:00.000Z"
  );
  assert.equal(
    new Date(latestDueAt(Date.parse("2026-11-01T00:00:00Z"))).toISOString(),
    "2026-10-31T23:00:00.000Z"
  );
});
test("missed grace, interrupted PID, timeout, failure and artifact checks", () => {
  assert.equal(issueFor({}, Date.parse("2026-10-12T00:59:59Z")), null);
  assert.equal(issueFor({}, Date.parse("2026-10-12T01:00:00Z")), "missed");
  assert.equal(issueFor({ lastAttemptStatus: "failed" }, noon), "failed");
  assert.equal(issueFor({ lastBackupAvailable: false }, noon), "artifact-missing");
  const running = {
    lastAttemptStatus: "running",
    lastAttemptAt: new Date(noon).toISOString(),
    pid: 123
  };
  assert.equal(
    issueFor(running, noon, () => true),
    null
  );
  assert.equal(
    issueFor(running, noon, () => false),
    "interrupted"
  );
  assert.equal(
    issueFor(running, noon + 51 * 60000, () => true),
    "interrupted"
  );
  assert.throws(() => validateState({ version: 1, lastSuccessAt: "invalid" }, noon));
  assert.throws(() =>
    validateState({ version: 1, lastSuccessAt: new Date(noon + 600000).toISOString() }, noon)
  );
});
test("success is quiet, skips same window; failures dedup and recovery notifies once", async (t) => {
  let fail = false,
    count = 0;
  const f = await fixture(t, {
    runBackup: async () => {
      count++;
      if (fail) throw new Error("secret failure");
      return { restoreVerified: true, bytes: 5, migrationCount: 8, backup: "backups/test.dump" };
    }
  });
  assert.equal((await f.controller.run()).ok, true);
  assert.equal((await f.controller.run()).skipped, "already-verified-for-due-window");
  assert.equal(count, 1);
  assert.equal(f.messages.length, 0);
  fail = true;
  assert.equal((await f.controller.run({ force: true })).ok, false);
  await f.controller.check();
  await f.controller.check();
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0], /FAILED/);
  assert.doesNotMatch(f.messages[0], /secret/);
  fail = false;
  assert.equal((await f.controller.run({ force: true })).ok, true);
  await f.controller.check();
  assert.equal(f.messages.length, 2);
  assert.match(f.messages[1], /RECOVERED/);
});
test("delivery failure retries after five minutes and cancels undelivered outage", async (t) => {
  let attempts = 0;
  const f = await fixture(t, {
    send: async () => {
      attempts++;
      throw new Error("offline");
    }
  });
  assert.equal((await f.controller.check()).ok, false);
  await f.controller.check();
  assert.equal(attempts, 1);
  f.tick(300000);
  await f.controller.check();
  assert.equal(attempts, 2);
  assert.equal((await f.controller.run()).ok, true);
  assert.equal(attempts, 2);
});
test("locks prevent overlap and stale locks fail closed", async (t) => {
  const f = await fixture(t);
  const lock = path.join(f.root, "lock");
  await fileLock(
    lock,
    () => true,
    async () => {
      assert.deepEqual(
        await fileLock(
          lock,
          () => true,
          async () => assert.fail()
        ),
        { busy: true }
      );
    }
  );
  await fs.writeFile(lock, JSON.stringify({ pid: 123, token: "old" }));
  await assert.rejects(
    fileLock(
      lock,
      () => false,
      async () => assert.fail()
    ),
    /Stale/
  );
});
test("missing artifact triggers failure and a replacement backup", async (t) => {
  let present = true;
  const f = await fixture(t, { artifactAvailable: async () => present });
  await f.controller.run();
  present = false;
  assert.equal((await f.controller.check()).issue, "artifact-missing");
  present = true;
  assert.equal((await f.controller.run({ force: true })).verified, true);
  assert.equal(f.messages.length, 2);
});
test("subprocess timeout, spawn failure and bounded output settle", async () => {
  await assert.rejects(
    run(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 100 }),
    /timed out/
  );
  await assert.rejects(run("meridian-nonexistent-command", [], { timeoutMs: 1000 }));
  assert.equal(await run(process.execPath, ["-e", "console.log('ok')"]), "ok");
});
test("real artifact header and size protect same-window skip", async (t) => {
  const f = await fixture(t, { artifactAvailable: undefined });
  await fs.mkdir(path.join(f.root, "backups"));
  await fs.writeFile(path.join(f.root, "backups/test.dump"), "PGDMP");
  await f.controller.run();
  assert.equal((await f.controller.status()).lastBackupAvailable, true);
  await fs.writeFile(path.join(f.root, "backups/test.dump"), "WRONG");
  assert.equal((await f.controller.check()).issue, "artifact-missing");
});
test("running retry does not emit premature recovery", async (t) => {
  let fail = true,
    inspect;
  const f = await fixture(t, {
    runBackup: async () => {
      if (fail) throw new Error("failed");
      inspect = await f.controller.check();
      return { restoreVerified: true, bytes: 5, migrationCount: 8, backup: "backups/test.dump" };
    }
  });
  await f.controller.run();
  fail = false;
  await f.controller.run({ force: true });
  assert.equal(inspect.issue, "running");
  assert.equal(f.messages.length, 2);
});
test("restore cleanup failure cannot return successful verification", async () => {
  const calls = [];
  const execute = async (_command, args, options) => {
    calls.push(args);
    if (options?.stdin) {
      for await (const chunk of options.stdin) {
        void chunk;
      }
    }
    if (args.includes("dropdb")) throw new Error("cleanup denied");
    if (args.at(-1).includes("requiredTablesPresent"))
      return JSON.stringify({
        requiredTablesPresent: true,
        migrationCount: 8,
        restoredCounts: { trades: 0 }
      });
    return "";
  };
  await assert.rejects(
    verify(parseArgs(["verify", "--file", "package.json"]), execute),
    /cleanup denied/
  );
  assert.ok(calls.at(-1).includes("--force"));
  assert.match(calls.at(-1).at(-1), /^meridian_restore_verify_/);
  assert.ok(calls.some((args) => args.at(-1).includes("timescaledb_pre_restore")));
  await assert.rejects(pruneLocalBackups(path.resolve(__dirname), 7, "unused"), /inside backups/);
});
