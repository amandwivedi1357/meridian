import type { MigrationRunnerDeps, SqlQuery } from "./migration-runner.js";

export interface PostgresQueryResult {
  readonly rows: readonly Record<string, unknown>[];
}

export interface PostgresLikeClient {
  readonly query: (
    text: string,
    values?: readonly unknown[]
  ) => Promise<PostgresQueryResult>;
}

export function createPostgresSqlExecutor(
  client: PostgresLikeClient
): (query: SqlQuery) => Promise<void> {
  return async (query) => {
    await client.query(query.text, query.values);
  };
}

export function createPostgresMigrationRunnerDeps(
  client: PostgresLikeClient
): MigrationRunnerDeps {
  return {
    execute: createPostgresSqlExecutor(client),

    async hasMigrationRun(id) {
      const result = await client.query(
        `
          SELECT id FROM schema_migrations
          WHERE id = $1
          LIMIT 1
        `,
        [id]
      );

      return result.rows.length > 0;
    }
  };
}