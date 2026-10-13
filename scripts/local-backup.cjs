/* global __dirname */
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Buffer } = require("node:buffer");
const { scheduled, parseArgs } = require("./db-backup.cjs");
const { telegram } = require("./setup-telegram-alerts.cjs");
const root = path.resolve(__dirname, "..");
const hour = 3600000;

function latestDueAt(now) {
  const local = new Date(now + 4 * hour);
  let due = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 3) - 4 * hour;
  if (due > now) due -= 24 * hour;
  return due;
}
function issueFor(state, now, alive = () => true) {
  if (state.lastAttemptStatus === "running") {
    if (!alive(state.pid) || now - Date.parse(state.lastAttemptAt) > (50 * hour) / 60)
      return "interrupted";
    return null;
  }
  if (state.lastAttemptStatus === "failed") return "failed";
  if (state.lastBackupAvailable === false) return "artifact-missing";
  if (
    (!state.lastSuccessAt || Date.parse(state.lastSuccessAt) < latestDueAt(now)) &&
    now >= latestDueAt(now) + 2 * hour
  )
    return "missed";
  return null;
}
function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}
async function readJson(file, fallback) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536)
      throw new Error("Invalid backup state file");
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.${randomUUID()}.partial`;
  try {
    await fs.writeFile(partial, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
    await fs.rename(partial, file);
  } finally {
    await fs.unlink(partial).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
}
async function fileLock(file, alive, run) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const token = randomUUID();
  let handle;
  try {
    handle = await fs.open(file, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const owner = await readJson(file, {});
    if (alive(owner.pid)) return { busy: true };
    throw new Error("Stale backup lock requires review");
  }
  const release = async () => {
    await handle.close().catch(() => {});
    const owner = await readJson(file, {});
    if (owner.token !== token) throw new Error("Backup lock ownership changed");
    await fs.unlink(file);
  };
  try {
    await handle.writeFile(JSON.stringify({ token, pid: process.pid }));
    await handle.close();
    return await run();
  } finally {
    await release();
  }
}
function validateState(state, now) {
  if (!state || typeof state !== "object" || Array.isArray(state) || state.version !== 1)
    throw new Error("Invalid backup state");
  for (const field of ["lastAttemptAt", "lastSuccessAt"])
    if (
      state[field] !== undefined &&
      (typeof state[field] !== "string" ||
        !Number.isFinite(Date.parse(state[field])) ||
        Date.parse(state[field]) > now + 300000)
    )
      throw new Error("Invalid backup timestamp");
  if (
    state.lastAttemptStatus !== undefined &&
    (!["running", "failed", "verified"].includes(state.lastAttemptStatus) || !state.lastAttemptAt)
  )
    throw new Error("Invalid backup status");
  return state;
}
async function sendBackupNotification(message, repoRoot = root) {
  const config = await readJson(path.join(repoRoot, "infra/alertmanager/.local/alertmanager.yml"));
  const target = config?.receivers?.find((r) => r.name === "telegram")?.telegram_configs?.[0];
  if (!target?.bot_token || !Number.isSafeInteger(target.chat_id))
    throw new Error("Private Telegram backup destination unavailable");
  await telegram(target.bot_token, "sendMessage", { chat_id: target.chat_id, text: message });
}
function createLocalBackupController(options = {}) {
  const repoRoot = options.root ?? root;
  const directory = path.join(repoRoot, "logs/verification/phase-5/backups/local");
  const stateFile = path.join(directory, "status.json");
  const now = options.now ?? Date.now;
  const alive = options.alive ?? processAlive;
  const send = options.send ?? sendBackupNotification;
  const runBackup =
    options.runBackup ?? (() => scheduled(parseArgs(["scheduled", "--keep-local", "7"])));
  const prefix = options.notificationPrefix ?? "Meridian local backup";
  const artifactAvailable =
    options.artifactAvailable ??
    (async (state) => {
      try {
        const artifactRoot = options.artifactRoot ?? repoRoot;
        const file = path.resolve(artifactRoot, state.backup);
        const backupRoot = path.join(artifactRoot, "backups");
        const relative = path.relative(backupRoot, file);
        if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== state.bytes) return false;
        const realRelative = path.relative(await fs.realpath(backupRoot), await fs.realpath(file));
        if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) return false;
        const handle = await fs.open(file, "r");
        try {
          const buffer = Buffer.alloc(5);
          await handle.read(buffer, 0, 5, 0);
          return buffer.toString() === "PGDMP";
        } finally {
          await handle.close();
        }
      } catch {
        return false;
      }
    });
  const state = async () => {
    const value = validateState(await readJson(stateFile, { version: 1 }), now());
    if (value.lastSuccessAt) value.lastBackupAvailable = await artifactAvailable(value);
    return value;
  };
  async function reconcile() {
    return fileLock(path.join(directory, ".notification.lock"), alive, async () => {
      let issue, current;
      try {
        current = await state();
        issue = issueFor(current, now(), alive);
      } catch {
        issue = "state-invalid";
      }
      let outbox = await readJson(path.join(directory, "notification.json"), {});
      if (!outbox || typeof outbox !== "object" || Array.isArray(outbox))
        throw new Error("Invalid notification state");
      for (const key of ["active", "delivered", "recovery"]) {
        if (outbox[key] !== undefined && typeof outbox[key] !== "boolean")
          throw new Error("Invalid notification flag");
      }
      for (const key of ["lastAttemptAt", "deliveredAt"]) {
        if (
          outbox[key] !== undefined &&
          (!Number.isFinite(Date.parse(outbox[key])) || Date.parse(outbox[key]) > now() + 300000)
        )
          throw new Error("Invalid notification timestamp");
      }
      if (
        outbox.active &&
        !["failed", "artifact-missing", "missed", "interrupted", "state-invalid"].includes(
          outbox.kind
        )
      )
        throw new Error("Invalid notification issue");
      if (!issue && current?.lastAttemptStatus === "running" && outbox.active)
        return { issue: "running", delivered: outbox.delivered === true };
      if (issue) {
        if (outbox.active && outbox.kind === issue && outbox.delivered)
          return { issue, delivered: true };
        if (!outbox.active || outbox.kind !== issue)
          outbox = { active: true, kind: issue, delivered: false };
      } else {
        if (outbox.active && outbox.delivered)
          outbox = { active: false, kind: outbox.kind, delivered: false, recovery: true };
        else if (outbox.active && !outbox.delivered) {
          await writeJson(path.join(directory, "notification.json"), {
            active: false,
            delivered: false,
            cancelled: true
          });
          return { issue: null, delivered: true };
        } else if (!outbox.recovery || outbox.delivered) return { issue: null, delivered: true };
      }
      if (outbox.lastAttemptAt && now() - Date.parse(outbox.lastAttemptAt) < 300000)
        return { issue, delivered: false };
      outbox.lastAttemptAt = new Date(now()).toISOString();
      await writeJson(path.join(directory, "notification.json"), outbox);
      const message = outbox.recovery
        ? `${prefix}: RECOVERED. Latest restore-verified backup is available and the due-window check is healthy. No trading action.`
        : `${prefix}: ${issue.toUpperCase()}. Backup/restore protection needs attention; inspect local task/status. No trading action.`;
      try {
        await send(message);
        outbox.delivered = true;
        outbox.deliveredAt = new Date(now()).toISOString();
        await writeJson(path.join(directory, "notification.json"), outbox);
        return { issue, delivered: true };
      } catch {
        await writeJson(path.join(directory, "notification.json"), {
          ...outbox,
          deliveryFailed: true
        });
        return { issue, delivered: false };
      }
    });
  }
  async function run({ force = false } = {}) {
    let result;
    try {
      result = await fileLock(path.join(directory, ".run.lock"), alive, async () => {
        const previous = await state();
        if (
          !force &&
          previous.lastSuccessAt &&
          previous.lastBackupAvailable !== false &&
          Date.parse(previous.lastSuccessAt) >= latestDueAt(now())
        )
          return { skipped: "already-verified-for-due-window" };
        const startedAt = new Date(now()).toISOString();
        await writeJson(stateFile, {
          ...previous,
          lastAttemptStatus: "running",
          lastAttemptAt: startedAt,
          pid: process.pid
        });
        try {
          const backup = await runBackup();
          if (
            !backup?.restoreVerified ||
            !Number.isSafeInteger(backup.bytes) ||
            backup.bytes < 1 ||
            !Number.isSafeInteger(backup.migrationCount) ||
            backup.migrationCount < 1
          )
            throw new Error("Backup result unverified");
          await writeJson(stateFile, {
            version: 1,
            lastAttemptAt: startedAt,
            lastAttemptStatus: "verified",
            lastSuccessAt: new Date(now()).toISOString(),
            backup: backup.backup,
            bytes: backup.bytes,
            migrationCount: backup.migrationCount,
            restoredCounts: backup.restoredCounts
          });
          return { verified: true, backup: backup.backup, bytes: backup.bytes };
        } catch {
          await writeJson(stateFile, {
            ...previous,
            lastAttemptAt: startedAt,
            lastAttemptStatus: "failed",
            reason: "backup-or-restore-failed"
          });
          return { verified: false };
        }
      });
    } catch {
      result = { verified: false, lockOrStateFailure: true };
      try {
        await writeJson(stateFile, {
          ...(await state()),
          lastAttemptAt: new Date(now()).toISOString(),
          lastAttemptStatus: "failed",
          reason: "lock-or-state-failure"
        });
      } catch {
        /* Invalid state stays invalid; monitor reports it. */
      }
    }
    const alert = await reconcile();
    return {
      ...result,
      alert,
      ok: result.verified !== false && !alert.busy && alert.delivered !== false
    };
  }
  async function check() {
    const alert = await reconcile();
    await writeJson(path.join(directory, "monitor.json"), {
      checkedAt: new Date(now()).toISOString(),
      ...alert
    });
    return { ok: !alert.busy && !alert.issue && alert.delivered !== false, ...alert };
  }
  return { run, check, status: state, directory };
}
module.exports = {
  latestDueAt,
  issueFor,
  validateState,
  createLocalBackupController,
  sendBackupNotification,
  fileLock
};
if (require.main === module) {
  const [command, flag, ...extra] = process.argv.slice(2);
  if (
    extra.length ||
    !["run", "check", "status"].includes(command) ||
    (flag && flag !== "--force") ||
    (flag && command !== "run")
  ) {
    console.error("Usage: node scripts/local-backup.cjs run [--force] | check | status");
    process.exitCode = 1;
  } else {
    const controller = createLocalBackupController();
    (command === "run"
      ? controller.run({ force: flag === "--force" })
      : command === "check"
        ? controller.check()
        : controller.status()
    )
      .then((result) => {
        console.log(JSON.stringify(result));
        if (result.ok === false) process.exitCode = 1;
      })
      .catch(async () => {
        // A full/unwritable disk may prevent durable outbox writes; attempt a generic alert.
        if (command !== "status")
          await sendBackupNotification(
            "Meridian local backup: MONITOR FAILURE. Local state/locks could not be updated. Inspect scheduler/files; no trading action."
          ).catch(() => {});
        console.error(
          "Local backup monitor failed; credentials withheld. Inspect task/status files."
        );
        process.exitCode = 1;
      });
  }
}
