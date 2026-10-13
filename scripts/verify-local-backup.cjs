/* global __dirname */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { scheduled, verify, parseArgs, run } = require("./db-backup.cjs");
const { createLocalBackupController, sendBackupNotification } = require("./local-backup.cjs");
const root = path.resolve(__dirname, "..");

async function main() {
  const token = randomUUID();
  const evidence = path.join(root, "logs/verification/phase-5/backups", `check-${token}`);
  const archives = path.join(root, "backups", `verification-${token}`);
  await fs.mkdir(evidence, { recursive: true });
  await fs.mkdir(archives, { recursive: true });
  let notifications = 0,
    corrupt = false,
    sequence = 0;
  const snapshots = [];
  const query = [
    "compose",
    "-f",
    "infra/docker-compose.yml",
    "exec",
    "-T",
    "timescaledb",
    "psql",
    "-U",
    "meridian",
    "-d",
    "meridian",
    "-Atc",
    "SELECT datname FROM pg_database WHERE datname LIKE 'meridian_restore_verify_%' ORDER BY datname"
  ];
  const before = await run("docker", query);
  const controller = createLocalBackupController({
    root: evidence,
    artifactRoot: root,
    notificationPrefix: "Meridian local backup [bounded verification]",
    send: async (message) => {
      assert.ok(notifications < 2, "Verification notification budget exceeded");
      await sendBackupNotification(message);
      notifications++;
    },
    runBackup: async () => {
      if (corrupt) {
        const file = path.join(archives, "corrupt-fixture.dump");
        await fs.writeFile(file, "PGDMP\u0000truncated-verification-fixture", { flag: "wx" });
        return verify(parseArgs(["verify", "--file", file]));
      }
      sequence++;
      const stamp = new Date()
        .toISOString()
        .replaceAll(/[-:]/g, "")
        .replace(/\.\d{3}/, "");
      const result = await scheduled(
        parseArgs([
          "scheduled",
          "--out",
          path.join(archives, `meridian-${stamp}.dump`),
          "--manifest-out",
          path.join(evidence, `snapshot-${sequence}.json`)
        ])
      );
      snapshots.push(result);
      return result;
    }
  });
  assert.equal((await controller.run()).verified, true);
  assert.equal(notifications, 0);
  corrupt = true;
  assert.equal((await controller.run({ force: true })).verified, false);
  assert.equal(notifications, 1);
  await controller.check();
  assert.equal(notifications, 1);
  corrupt = false;
  assert.equal((await controller.run({ force: true })).verified, true);
  assert.equal(notifications, 2);
  assert.equal((await controller.check()).ok, true);
  assert.equal(
    await run("docker", query),
    before,
    "Disposable restore databases must be cleaned up"
  );
  const result = {
    ok: true,
    snapshots: snapshots.map(({ bytes, migrationCount, restoredCounts }) => ({
      bytes,
      migrationCount,
      restoredCounts
    })),
    corruptRestoreRejected: true,
    disposableCleanupVerified: true,
    telegramAccepted: notifications,
    tradingActions: 0
  };
  await fs.writeFile(path.join(evidence, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidence: path.relative(root, evidence) }));
}
main().catch(() => {
  console.error(
    "Local backup verification failed; inspect ignored evidence. Credentials withheld."
  );
  process.exitCode = 1;
});
