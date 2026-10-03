import { describe, expect, it } from "vitest";
import { marketDataMigrations } from "./market-data-migrations.js";

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

describe("market data migrations", () => {
  it("creates Timescale extension and trades/klines hypertables", () => {
    expect(marketDataMigrations).toHaveLength(1);

    const migration = marketDataMigrations[0];
    expect(migration?.id).toBe("001_market_data_schema");

    const sql = normalizeSql(migration?.sql ?? "");

    expect(sql).toContain("create extension if not exists timescaledb");
    expect(sql).toContain("create table if not exists trades");
    expect(sql).toContain("create table if not exists klines");
    expect(sql).toContain("create_hypertable('trades', 'event_time'");
    expect(sql).toContain("create_hypertable('klines', 'open_time'");
  });

  it("defines idempotency keys used by the ingestor upserts", () => {
    const sql = normalizeSql(marketDataMigrations[0]?.sql ?? "");

    expect(sql).toContain("unique (symbol, event_id)");
    expect(sql).toContain("unique (symbol, interval, open_time)");
  });

  it("stores prices and quantities as exact numeric values", () => {
    const sql = normalizeSql(marketDataMigrations[0]?.sql ?? "");

    expect(sql).toContain("price numeric");
    expect(sql).toContain("quantity numeric");
    expect(sql).toContain("open numeric");
    expect(sql).toContain("high numeric");
    expect(sql).toContain("low numeric");
    expect(sql).toContain("close numeric");
    expect(sql).toContain("volume numeric");
  });
});
