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
        UNIQUE (symbol, event_id)
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
  }
];
