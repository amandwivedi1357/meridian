import { describe, expect, it, vi } from "vitest";
import { createPostgresMigrationRunnerDeps, createPostgresSqlExecutor } from "./postgres-adapter.js";

describe("postgres adapter", () => {
  it("executes SQL queries through a postgres-style client", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const execute = createPostgresSqlExecutor({ query });

    await execute({
      text: "SELECT $1::text",
      values: ["ok"]
    });

    expect(query).toHaveBeenCalledWith("SELECT $1::text", ["ok"]);
  });

  it("checks whether a migration id exists", async () => {
    const query = vi.fn(async () => ({
      rows: [{ id: "001_done" }]
    }));
    const deps = createPostgresMigrationRunnerDeps({ query });

    const exists = await deps.hasMigrationRun("001_done");

    expect(exists).toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SELECT id FROM schema_migrations"),
      ["001_done"]
    );
  });

  it("returns false when a migration id has not run", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const deps = createPostgresMigrationRunnerDeps({ query });

    await expect(deps.hasMigrationRun("001_missing")).resolves.toBe(false);
  });
});
