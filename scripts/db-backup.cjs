/* global __dirname */
const { createReadStream, createWriteStream } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const defaults = {
  composeFile: "infra/docker-compose.yml",
  service: "timescaledb",
  user: "meridian",
  database: "meridian"
};

function usage() {
  return `Usage:
  node scripts/db-backup.cjs backup [--out backups/meridian-YYYYMMDDTHHMMSSZ.dump]
  node scripts/db-backup.cjs verify --file backups/meridian-YYYYMMDDTHHMMSSZ.dump
  node scripts/db-backup.cjs scheduled [--keep-local 7]

Options:
  --compose-file <path>  Docker Compose file. Default: ${defaults.composeFile}
  --service <name>      Compose service with pg_dump/pg_restore. Default: ${defaults.service}
  --user <name>         Database user. Default: ${defaults.user}
  --database <name>     Source database for backup. Default: ${defaults.database}
  --manifest-out <path> Evidence JSON path for scheduled runs.
  --keep-local <count>  Number of local dumps to keep for scheduled runs. Default: 7`;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!["backup", "verify", "scheduled"].includes(command)) throw new Error(usage());

  const options = { ...defaults, command, keepLocal: 7 };
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i];
    const value = rest[i + 1];
    if (!key?.startsWith("--")) throw new Error(`Unexpected argument: ${key}\n${usage()}`);
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    i += 1;
    if (key === "--out") options.out = value;
    else if (key === "--file") options.file = value;
    else if (key === "--compose-file") options.composeFile = value;
    else if (key === "--service") options.service = value;
    else if (key === "--user") options.user = value;
    else if (key === "--database") options.database = value;
    else if (key === "--manifest-out") options.manifestOut = value;
    else if (key === "--keep-local") options.keepLocal = parsePositiveInteger(value, key);
    else throw new Error(`Unknown option: ${key}\n${usage()}`);
  }
  if (command === "verify" && !options.file) throw new Error("verify requires --file");
  return options;
}

function parsePositiveInteger(value, name) {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${name} must be a positive integer`);
  return Number(value);
}

function stamp(date = new Date()) {
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}/, "");
}

function defaultBackupPath(repoRoot = root, date = new Date()) {
  return path.join(repoRoot, "backups", `meridian-${stamp(date)}.dump`);
}

function defaultManifestPath(repoRoot = root, date = new Date()) {
  return path.join(repoRoot, "logs", "verification", "phase-5", "backups", `backup-${stamp(date)}.json`);
}

function resolveBackupPath(repoRoot, input) {
  const resolved = path.resolve(repoRoot, input);
  const relative = path.relative(repoRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Backup path must stay inside the repository");
  }
  return resolved;
}

function buildComposePrefix({ composeFile }) {
  return ["compose", "-f", composeFile, "exec", "-T"];
}

function buildBackupCommand({ composeFile, service, user, database }) {
  return [
    "docker",
    [
      ...buildComposePrefix({ composeFile }),
      service,
      "pg_dump",
      "-U",
      user,
      "-d",
      database,
      "--format=custom",
      "--no-owner",
      "--no-privileges"
    ]
  ];
}

function buildRestoreCommand({ composeFile, service, user, database }) {
  return [
    "docker",
    [
      ...buildComposePrefix({ composeFile }),
      service,
      "pg_restore",
      "-U",
      user,
      "-d",
      database,
      "--exit-on-error",
      "--no-owner",
      "--no-privileges"
    ]
  ];
}

function buildSimpleDbCommand({ composeFile, service, user, command, database }) {
  return [
    "docker",
    [...buildComposePrefix({ composeFile }), service, command, "-U", user, database]
  ];
}

function buildSqlCheckCommand({ composeFile, service, user, database }) {
  const sql = `
    WITH required_tables(name, present) AS (
      VALUES
        ('schema_migrations', to_regclass('public.schema_migrations') IS NOT NULL),
        ('trades', to_regclass('public.trades') IS NOT NULL),
        ('klines', to_regclass('public.klines') IS NOT NULL),
        ('orders', to_regclass('public.orders') IS NOT NULL),
        ('order_fills', to_regclass('public.order_fills') IS NOT NULL),
        ('risk_events', to_regclass('public.risk_events') IS NOT NULL),
        ('backtest_runs', to_regclass('public.backtest_runs') IS NOT NULL)
    )
    SELECT json_build_object(
      'requiredTablesPresent', bool_and(present),
      'missingTables', coalesce(json_agg(name) FILTER (WHERE NOT present), '[]'::json),
      'migrationCount', (SELECT count(*) FROM public.schema_migrations)
    )::text
    FROM required_tables;
  `;
  return [
    "docker",
    [
      ...buildComposePrefix({ composeFile }),
      service,
      "psql",
      "-U",
      user,
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-Atc",
      sql
    ]
  ];
}

function safeRestoreDatabaseName(prefix, token = randomUUID()) {
  if (!/^[a-z_][a-z0-9_]*$/.test(prefix)) throw new Error("Restore database prefix must be a safe SQL identifier");
  const suffix = token.replaceAll(/[^a-zA-Z0-9]/g, "").slice(0, 24).toLowerCase();
  const name = `${prefix}_${suffix}`;
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw new Error("Restore database name must be a safe SQL identifier");
  return name;
}

function selectPrunableBackups(entries, keep, protectedPath) {
  return entries
    .filter((entry) => entry.name.endsWith(".dump"))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(keep)
    .map((entry) => entry.fullPath)
    .filter((file) => path.resolve(file) !== path.resolve(protectedPath));
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    if (options.stdin) options.stdin.pipe(child.stdin);
    else child.stdin.end();
    if (options.stdout) child.stdout.pipe(options.stdout);
    else {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

async function backup(options) {
  const output = options.out
    ? resolveBackupPath(root, options.out)
    : defaultBackupPath(root, new Date());
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs
    .access(output)
    .then(() => {
      throw new Error(`Backup file already exists: ${path.relative(root, output)}`);
    })
    .catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  const partial = `${output}.partial`;
  await fs.rm(partial, { force: true });
  const stream = createWriteStream(partial, { flags: "wx" });
  const finished = new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  const [command, args] = buildBackupCommand(options);
  try {
    await run(command, args, { stdout: stream });
    await finished;
    await fs.rename(partial, output);
    const stat = await fs.stat(output);
    return { backup: path.relative(root, output), bytes: stat.size, format: "pg_dump-custom" };
  } catch (error) {
    stream.destroy();
    await fs.rm(partial, { force: true });
    throw error;
  }
}

async function verify(options) {
  const file = resolveBackupPath(root, options.file);
  await fs.access(file);
  const restoreDb = safeRestoreDatabaseName("meridian_restore_verify");
  const create = buildSimpleDbCommand({
    ...options,
    command: "createdb",
    database: restoreDb
  });
  const drop = buildSimpleDbCommand({
    ...options,
    command: "dropdb",
    database: restoreDb
  });
  let cleanup = false;
  try {
    await run(...create);
    cleanup = true;
    await run(...buildRestoreCommand({ ...options, database: restoreDb }), {
      stdin: createReadStream(file)
    });
    const raw = await run(...buildSqlCheckCommand({ ...options, database: restoreDb }));
    const checks = JSON.parse(raw);
    if (!checks.requiredTablesPresent) {
      throw new Error(`Restore verification missing tables: ${checks.missingTables.join(", ")}`);
    }
    return {
      backup: path.relative(root, file),
      restoreDatabase: restoreDb,
      migrationCount: Number(checks.migrationCount),
      requiredTablesPresent: true
    };
  } finally {
    if (cleanup) {
      await run(...drop).catch(() => {});
    }
  }
}

async function pruneLocalBackups(directory, keep, protectedPath) {
  const entries = await fs
    .readdir(directory, { withFileTypes: true })
    .then(async (items) =>
      Promise.all(
        items
          .filter((item) => item.isFile())
          .map(async (item) => {
            const fullPath = path.join(directory, item.name);
            const stat = await fs.stat(fullPath);
            return { name: item.name, fullPath, mtimeMs: stat.mtimeMs };
          })
      )
    )
    .catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
  const pruned = selectPrunableBackups(entries, keep, protectedPath);
  for (const file of pruned) await fs.rm(file, { force: true });
  return pruned.map((file) => path.relative(root, file));
}

async function scheduled(options) {
  const startedAt = new Date();
  const backupResult = await backup({ ...options, out: options.out });
  const verifyResult = await verify({ ...options, file: backupResult.backup });
  const backupFile = path.resolve(root, backupResult.backup);
  const pruned = await pruneLocalBackups(path.dirname(backupFile), options.keepLocal, backupFile);
  const result = {
    ok: true,
    command: "scheduled",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    backup: backupResult.backup,
    bytes: backupResult.bytes,
    format: backupResult.format,
    restoreVerified: verifyResult.requiredTablesPresent,
    migrationCount: verifyResult.migrationCount,
    keepLocal: options.keepLocal,
    pruned
  };
  const manifestPath = options.manifestOut
    ? resolveBackupPath(root, options.manifestOut)
    : defaultManifestPath(root, startedAt);
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify(result, null, 2)}\n`);
  return { ...result, manifest: path.relative(root, manifestPath) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result =
    options.command === "backup"
      ? await backup(options)
      : options.command === "verify"
        ? await verify(options)
        : await scheduled(options);
  console.log(JSON.stringify({ ok: true, command: options.command, ...result }, null, 2));
}

module.exports = {
  buildBackupCommand,
  buildRestoreCommand,
  buildSqlCheckCommand,
  defaultBackupPath,
  defaultManifestPath,
  parseArgs,
  resolveBackupPath,
  safeRestoreDatabaseName,
  selectPrunableBackups
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
