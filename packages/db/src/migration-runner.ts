export interface SqlQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

export interface SqlMigration {
  readonly id: string;
  readonly sql: string;
}

export interface MigrationRunnerDeps {
  readonly execute: (query: SqlQuery) => Promise<void>;
  readonly hasMigrationRun: (id: string) => Promise<boolean>;
}

export interface MigrationRunResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

export async function runMigrations(
  migrations: readonly SqlMigration[],
  deps: MigrationRunnerDeps
): Promise<MigrationRunResult> {
  const applied: string[] = [];
  const skipped: string[] = [];

  await deps.execute({
    text: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `,
    values: []
  });

  for (const migration of migrations) {
    const alreadyRun = await deps.hasMigrationRun(migration.id);

    if (alreadyRun) {
      skipped.push(migration.id);
      continue;
    }

    await deps.execute({
      text: migration.sql,
      values: []
    });

    await deps.execute({
      text: `
        INSERT INTO schema_migrations (id)
        VALUES ($1)
        ON CONFLICT (id) DO NOTHING
      `,
      values: [migration.id]
    });

    applied.push(migration.id);
  }

  return { applied, skipped };
}