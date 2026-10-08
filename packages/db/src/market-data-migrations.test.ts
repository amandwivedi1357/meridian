import { describe, expect, it } from "vitest";
import { marketDataMigrations } from "./market-data-migrations.js";

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

describe("market data migrations", () => {
  it("creates Timescale extension and trades/klines hypertables", () => {
    expect(marketDataMigrations).toHaveLength(4);

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

    expect(sql).toContain("unique (symbol, event_id, event_time)");
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

  it("creates backtest run, fill, and equity result tables", () => {
    const migration = marketDataMigrations[1];
    expect(migration?.id).toBe("002_backtest_results_schema");

    const sql = normalizeSql(migration?.sql ?? "");

    expect(sql).toContain("create table if not exists backtest_runs");
    expect(sql).toContain("run_id text primary key");
    expect(sql).toContain("params jsonb not null");
    expect(sql).toContain("metrics jsonb not null");
    expect(sql).toContain("create table if not exists backtest_fills");
    expect(sql).toContain("references backtest_runs(run_id) on delete cascade");
    expect(sql).toContain("primary key (run_id, fill_index)");
    expect(sql).toContain("create table if not exists backtest_equity_points");
    expect(sql).toContain("primary key (run_id, point_index)");
  });

  it("stores backtest monetary values as exact numeric values", () => {
    const sql = normalizeSql(marketDataMigrations[1]?.sql ?? "");

    expect(sql).toContain("quantity numeric");
    expect(sql).toContain("price numeric");
    expect(sql).toContain("fee numeric");
    expect(sql).toContain("equity numeric");
  });

  it("creates live order write-ahead tables", () => {
    const migration = marketDataMigrations[2];
    expect(migration?.id).toBe("003_live_order_write_ahead_schema");

    const sql = normalizeSql(migration?.sql ?? "");

    expect(sql).toContain("create table if not exists orders");
    expect(sql).toContain("client_order_id text primary key");
    expect(sql).toContain("strategy_id text not null");
    expect(sql).toContain("signal_id text not null");
    expect(sql).toContain("symbol text not null");
    expect(sql).toContain("side text not null");
    expect(sql).toContain("type text not null");
    expect(sql).toContain("quantity numeric not null");
    expect(sql).toContain("limit_price numeric");
    expect(sql).toContain("state text not null");
    expect(sql).toContain("created_at timestamptz not null default now()");
    expect(sql).toContain("updated_at timestamptz not null default now()");
    expect(sql).toContain("unique (strategy_id, signal_id, attempt)");
  });

  it("indexes live orders for reconciliation scans", () => {
    const sql = normalizeSql(marketDataMigrations[2]?.sql ?? "");

    expect(sql).toContain("orders_state_updated_at_idx");
    expect(sql).toContain("on orders (state, updated_at)");
    expect(sql).toContain("orders_symbol_state_idx");
    expect(sql).toContain("on orders (symbol, state)");
  });

  it("adds live execution metadata and fee-aware order fills", () => {
    const migration = marketDataMigrations[3];
    expect(migration?.id).toBe("004_live_order_execution_schema");

    const sql = normalizeSql(migration?.sql ?? "");

    expect(sql).toContain("alter table orders");
    expect(sql).toContain("add column if not exists exchange_order_id text");
    expect(sql).toContain("add column if not exists executed_quantity numeric not null default 0");
    expect(sql).toContain(
      "add column if not exists cumulative_quote_quantity numeric not null default 0"
    );
    expect(sql).toContain("add column if not exists last_exchange_event_time_ms bigint");
    expect(sql).toContain("create table if not exists order_fills");
    expect(sql).toContain("client_order_id text not null references orders(client_order_id)");
    expect(sql).toContain("execution_id text not null");
    expect(sql).toContain("trade_id text not null");
    expect(sql).toContain("fee numeric not null");
    expect(sql).toContain("fee_asset text not null");
    expect(sql).toContain("primary key (client_order_id, execution_id)");
  });
});
