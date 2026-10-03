import { describe, expect, it, vi } from "vitest";
import { runMigrations, type SqlMigration, type SqlQuery } from "./migration-runner.js";

describe("runMigrations", () => {
  it("creates migration metadata table before running migrations", async () => {
    let firstQuery: SqlQuery | undefined;
    const execute = vi.fn(async (query: SqlQuery) => {
      firstQuery ??= query;
    });
    const hasMigrationRun = vi.fn(async () => false);

    await runMigrations(
      [{ id: "001_test", sql: "CREATE TABLE example (id text);" }],
      { execute, hasMigrationRun }
    );

    expect(firstQuery?.text).toContain("CREATE TABLE IF NOT EXISTS schema_migrations");
  });

  it("runs pending migrations in order and records each one", async () => {
    const migrations: readonly SqlMigration[] = [
      { id: "001_first", sql: "SELECT 1;" },
      { id: "002_second", sql: "SELECT 2;" }
    ];
    const execute = vi.fn(async () => undefined);
    const hasMigrationRun = vi.fn(async () => false);

    const result = await runMigrations(migrations, { execute, hasMigrationRun });

    expect(hasMigrationRun).toHaveBeenNthCalledWith(1, "001_first");
    expect(hasMigrationRun).toHaveBeenNthCalledWith(2, "002_second");
    expect(execute).toHaveBeenCalledWith({ text: "SELECT 1;", values: [] });
    expect(execute).toHaveBeenCalledWith({ text: "SELECT 2;", values: [] });
    expect(execute).toHaveBeenCalledWith({
      text: expect.stringContaining("INSERT INTO schema_migrations"),
      values: ["001_first"]
    });
    expect(execute).toHaveBeenCalledWith({
      text: expect.stringContaining("INSERT INTO schema_migrations"),
      values: ["002_second"]
    });
    expect(result).toEqual({
      applied: ["001_first", "002_second"],
      skipped: []
    });
  });

  it("skips migrations that were already applied", async () => {
    let firstQuery: SqlQuery | undefined;
    const execute = vi.fn(async (query: SqlQuery) => {
      firstQuery ??= query;
    });
    const hasMigrationRun = vi.fn(async () => true);

    const result = await runMigrations([{ id: "001_done", sql: "SELECT 1;" }], {
      execute,
      hasMigrationRun
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(firstQuery?.text).toContain("CREATE TABLE IF NOT EXISTS schema_migrations");
    expect(result).toEqual({
      applied: [],
      skipped: ["001_done"]
    });
  });
});
