import { fileURLToPath } from "node:url";
import { loadEnvFile } from "node:process";
import { Pool } from "pg";
import {
  createPostgresMigrationRunnerDeps,
  marketDataMigrations,
  runMigrations
} from "@meridian/db";

try {
  loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://meridian:meridian@localhost:5432/meridian",
  max: 1,
  connectionTimeoutMillis: 2000,
  statement_timeout: 30000
});
try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(9041002)");
    const result = await runMigrations(
      marketDataMigrations,
      createPostgresMigrationRunnerDeps(client)
    );
    await client.query("COMMIT");
    console.log(JSON.stringify(result));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
} catch {
  console.error("Database migration failed; verify DATABASE_URL and Timescale availability.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
