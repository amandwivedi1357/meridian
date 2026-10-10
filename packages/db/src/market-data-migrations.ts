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
  },
  {
    id: "004_live_order_execution_schema",
    sql: `
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS exchange_order_id text,
        ADD COLUMN IF NOT EXISTS executed_quantity numeric NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS cumulative_quote_quantity numeric NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS last_exchange_event_time_ms bigint NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS last_execution_id text;

      CREATE TABLE IF NOT EXISTS order_fills (
        client_order_id text NOT NULL REFERENCES orders(client_order_id) ON DELETE CASCADE,
        execution_id text NOT NULL,
        trade_id text NOT NULL,
        symbol text NOT NULL,
        side text NOT NULL,
        quantity numeric NOT NULL,
        price numeric NOT NULL,
        fee numeric NOT NULL,
        fee_asset text NOT NULL,
        event_time_ms bigint NOT NULL,
        PRIMARY KEY (client_order_id, execution_id)
      );

      CREATE INDEX IF NOT EXISTS order_fills_client_event_time_idx
        ON order_fills (client_order_id, event_time_ms);
      CREATE UNIQUE INDEX IF NOT EXISTS order_fills_client_trade_id_idx
        ON order_fills (client_order_id, trade_id);
      `
    },
  {
    id: "005_risk_controls_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS risk_events (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        ts timestamptz NOT NULL DEFAULT now(),
        type text NOT NULL,
        details jsonb NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        ts timestamptz NOT NULL DEFAULT now(),
        actor text NOT NULL,
        action text NOT NULL,
        details jsonb NOT NULL
      );
      CREATE TABLE IF NOT EXISTS risk_control_state (
        scope text PRIMARY KEY,
        engaged boolean NOT NULL DEFAULT true,
        reason text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO risk_control_state (scope, engaged, reason)
        VALUES ('global', true, 'awaiting-explicit-activation') ON CONFLICT DO NOTHING;
      CREATE TABLE IF NOT EXISTS risk_equity_state (
        scope text PRIMARY KEY,
        quote_asset text NOT NULL,
        peak numeric NOT NULL CHECK (peak > 0),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS risk_reservations (
        signal_id text PRIMARY KEY,
        strategy_id text NOT NULL,
        symbol text NOT NULL,
        side text NOT NULL CHECK (side IN ('BUY', 'SELL')),
        quantity numeric NOT NULL CHECK (quantity > 0),
        notional numeric NOT NULL CHECK (notional > 0),
        reserved_at_ms bigint NOT NULL,
        valid_until_ms bigint NOT NULL
      );
      CREATE INDEX IF NOT EXISTS risk_reservations_strategy_time_idx
        ON risk_reservations (strategy_id, reserved_at_ms);
      CREATE INDEX IF NOT EXISTS risk_events_ts_idx ON risk_events (ts DESC);
      CREATE INDEX IF NOT EXISTS orders_strategy_created_idx ON orders (strategy_id, created_at);
    `
  },
  {
    id: "006_order_fills_trade_id_dedupe_index",
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS order_fills_client_trade_id_idx
        ON order_fills (client_order_id, trade_id);
    `
  },
  {
    id: "007_strategy_control_state",
    sql: `
      CREATE TABLE IF NOT EXISTS strategy_control_state (
        strategy_id text PRIMARY KEY,
        paused boolean NOT NULL,
        reason text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS strategy_control_paused_idx
        ON strategy_control_state (paused, updated_at);
    `
  }
];
