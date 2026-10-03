import {
  createPostgresMigrationRunnerDeps,
  marketDataMigrations,
  runMigrations,
  type MigrationRunResult,
  type PostgresLikeClient
} from "@meridian/db";

export async function runIngestorStartupMigrations(
  client: PostgresLikeClient
): Promise<MigrationRunResult> {
  return runMigrations(
    marketDataMigrations,
    createPostgresMigrationRunnerDeps(client)
  );
}
