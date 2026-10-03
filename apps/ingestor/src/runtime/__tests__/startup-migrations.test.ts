import { marketDataMigrations } from "@meridian/db";
import { describe, expect, it, vi } from "vitest";
import { runIngestorStartupMigrations } from "../startup-migrations.js";

describe("runIngestorStartupMigrations", () => {
  it("runs the market data migrations using a postgres-style client", async () => {
    const query = vi.fn(async () => ({ rows: [] }));

    const result = await runIngestorStartupMigrations({ query });

    expect(result.applied).toEqual(marketDataMigrations.map((migration) => migration.id));
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("CREATE TABLE IF NOT EXISTS schema_migrations"),
      []
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SELECT id FROM schema_migrations"),
      ["001_market_data_schema"]
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("CREATE TABLE IF NOT EXISTS trades"),
      []
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO schema_migrations"),
      ["001_market_data_schema"]
    );
  });
});
