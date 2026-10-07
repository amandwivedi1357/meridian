import type { SqlMigration } from "./migration-runner.js";

export const marketDataMigrations: readonly SqlMigration[] = [
  {
    id: "001_market_data_schema",
    sql: `
      CREATE EXTENSION IF NOT EXISTS timescaledb;

      CREATE TABLE IF NOT EXISTS trades (
        symbol text NOT NULL,
        event_id text NOT NULL,
        trade_id text NOT NULL,
        event_time timestamptz NOT NULL,
        price numeric NOT NULL,
        quantity numeric NOT NULL,
        is_buyer_maker boolean NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (symbol, event_id, event_time)
      );

      SELECT create_hypertable('trades', 'event_time', if_not_exists => TRUE);

      CREATE TABLE IF NOT EXISTS klines (
        symbol text NOT NULL,
        event_id text NOT NULL,
        interval text NOT NULL,
        open_time timestamptz NOT NULL,
        close_time timestamptz NOT NULL,
        open numeric NOT NULL,
        high numeric NOT NULL,
        low numeric NOT NULL,
        close numeric NOT NULL,
        volume numeric NOT NULL,
        closed boolean NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (symbol, interval, open_time)
      );

      SELECT create_hypertable('klines', 'open_time', if_not_exists => TRUE);
    `
  },
  {
    id: "002_backtest_results_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS backtest_runs (
        run_id text PRIMARY KEY,
        strategy text NOT NULL,
        symbol text NOT NULL,
        interval text NOT NULL,
        from_ms bigint NOT NULL,
        to_ms bigint NOT NULL,
        params jsonb NOT NULL,
        metrics jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS backtest_runs_strategy_created_at_idx
        ON backtest_runs (strategy, created_at DESC);

      CREATE TABLE IF NOT EXISTS backtest_fills (
        run_id text NOT NULL REFERENCES backtest_runs(run_id) ON DELETE CASCADE,
        fill_index integer NOT NULL,
        symbol text NOT NULL,
        side text NOT NULL,
        quantity numeric NOT NULL,
        price numeric NOT NULL,
        fee numeric NOT NULL,
        fee_asset text NOT NULL,
        ts_ms bigint NOT NULL,
        PRIMARY KEY (run_id, fill_index)
      );

      CREATE TABLE IF NOT EXISTS backtest_equity_points (
        run_id text NOT NULL REFERENCES backtest_runs(run_id) ON DELETE CASCADE,
        point_index integer NOT NULL,
        ts_ms bigint NOT NULL,
        equity numeric NOT NULL,
        PRIMARY KEY (run_id, point_index)
      );
    `
  },
  {
    id: "003_live_order_write_ahead_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS orders (
        client_order_id text PRIMARY KEY,
        strategy_id text NOT NULL,
        signal_id text NOT NULL,
        attempt integer NOT NULL,
        symbol text NOT NULL,
        side text NOT NULL,
        type text NOT NULL,
        quantity numeric NOT NULL,
        limit_price numeric,
        state text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (strategy_id, signal_id, attempt)
      );

      CREATE INDEX IF NOT EXISTS orders_state_updated_at_idx
        ON orders (state, updated_at);

      CREATE INDEX IF NOT EXISTS orders_symbol_state_idx
        ON orders (symbol, state);
    `
  }
];
