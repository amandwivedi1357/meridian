const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const {
  buildBackupCommand,
  buildRestoreCommand,
  buildSqlCheckCommand,
  defaultBackupPath,
  defaultManifestPath,
  parseArgs,
  resolveBackupPath,
  safeRestoreDatabaseName,
  selectPrunableBackups
} = require("./db-backup.cjs");

const root = path.resolve(__dirname, "..");

test("backup command uses docker compose exec and streams custom-format dump", () => {
  assert.deepEqual(
    buildBackupCommand({
      composeFile: "infra/docker-compose.yml",
      service: "timescaledb",
      user: "meridian",
      database: "meridian"
    }),
    [
      "docker",
      [
        "compose",
        "-f",
        "infra/docker-compose.yml",
        "exec",
        "-T",
        "timescaledb",
        "pg_dump",
        "-U",
        "meridian",
        "-d",
        "meridian",
        "--format=custom",
        "--no-owner",
        "--no-privileges"
      ]
    ]
  );
});

test("restore command reads a dump into a disposable verification database", () => {
  assert.deepEqual(
    buildRestoreCommand({
      composeFile: "infra/docker-compose.yml",
      service: "timescaledb",
      user: "meridian",
      database: "meridian_restore_verify_abc123"
    }),
    [
      "docker",
      [
        "compose",
        "-f",
        "infra/docker-compose.yml",
        "exec",
        "-T",
        "timescaledb",
        "pg_restore",
        "-U",
        "meridian",
        "-d",
        "meridian_restore_verify_abc123",
        "--exit-on-error",
        "--no-owner",
        "--no-privileges"
      ]
    ]
  );
});

test("verification SQL checks core schema without asserting row counts", () => {
  const [, args] = buildSqlCheckCommand({
    composeFile: "infra/docker-compose.yml",
    service: "timescaledb",
    user: "meridian",
    database: "verify_db"
  });

  const sql = args.at(-1);
  assert.match(sql, /schema_migrations/);
  assert.match(sql, /trades/);
  assert.match(sql, /klines/);
  assert.match(sql, /orders/);
  assert.match(sql, /backtest_runs/);
});

test("backup paths stay inside the repository backup directory by default", () => {
  const backup = defaultBackupPath(root, new Date("2026-10-12T10:20:30.000Z"));
  assert.equal(backup, path.join(root, "backups", "meridian-20261012T102030Z.dump"));
  assert.equal(resolveBackupPath(root, "backups/example.dump"), path.join(root, "backups", "example.dump"));
  assert.throws(() => resolveBackupPath(root, "..\\outside.dump"), /inside the repository/);
});

test("restore database names are generated as safe identifiers", () => {
  assert.equal(
    safeRestoreDatabaseName("meridian_restore_verify", "abc-def"),
    "meridian_restore_verify_abcdef"
  );
  assert.throws(() => safeRestoreDatabaseName("bad-name", "abc"), /identifier/);
});

test("argument parser keeps backup and verify modes explicit", () => {
  assert.deepEqual(parseArgs(["backup", "--out", "backups/a.dump"]).command, "backup");
  assert.deepEqual(parseArgs(["verify", "--file", "backups/a.dump"]).command, "verify");
  assert.deepEqual(parseArgs(["scheduled", "--keep-local", "3"]).keepLocal, 3);
  assert.throws(() => parseArgs(["verify"]), /--file/);
  assert.throws(() => parseArgs(["scheduled", "--keep-local", "0"]), /positive integer/);
  assert.throws(() => parseArgs(["unknown"]), /Usage/);
});

test("scheduled manifests use ignored verification logs", () => {
  assert.equal(
    defaultManifestPath(root, new Date("2026-10-12T10:20:30.000Z")),
    path.join(root, "logs", "verification", "phase-5", "backups", "backup-20261012T102030Z.json")
  );
});

test("local retention prunes oldest dumps and never prunes protected dump", () => {
  const files = [
    { name: "old.dump", fullPath: path.join(root, "backups", "old.dump"), mtimeMs: 1 },
    { name: "new.dump", fullPath: path.join(root, "backups", "new.dump"), mtimeMs: 3 },
    { name: "current.dump", fullPath: path.join(root, "backups", "current.dump"), mtimeMs: 2 },
    { name: "note.txt", fullPath: path.join(root, "backups", "note.txt"), mtimeMs: 0 }
  ];
  assert.deepEqual(selectPrunableBackups(files, 1, files[2].fullPath), [files[0].fullPath]);
  assert.deepEqual(selectPrunableBackups(files, 2, files[2].fullPath), [files[0].fullPath]);
});
