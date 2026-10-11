import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { Registry } from "@meridian/observability";
import { expect, it } from "vitest";
import { createLedgerMetrics, ledgerMetricsSql } from "./ledger-metrics.js";

it.skipIf(!process.env.API_TEST_DATABASE_URL)(
  "reads committed jobs and deduplicated persisted fill timing in isolated PostgreSQL",
  async () => {
    const admin = new Pool({ connectionString: process.env.API_TEST_DATABASE_URL });
    const schema = `metrics_${randomUUID().replaceAll("-", "")}`;
    const pool = new Pool({
      connectionString: process.env.API_TEST_DATABASE_URL,
      options: `-c search_path=${schema}`
    });
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      await pool.query(`CREATE TABLE orders (client_order_id text PRIMARY KEY, state text, created_at timestamptz);
      CREATE TABLE backtest_jobs (state text);
      CREATE TABLE order_fills (client_order_id text, execution_id text, event_time_ms bigint, PRIMARY KEY(client_order_id, execution_id));
      INSERT INTO orders VALUES ('fixture','PARTIALLY_FILLED',to_timestamp(1000));
      INSERT INTO backtest_jobs VALUES ('succeeded'),('failed'),('queued');
      INSERT INTO order_fills VALUES ('fixture','1',1000100),('fixture','2',1000200),('fixture','3',999999);
      INSERT INTO order_fills VALUES ('fixture','1',1000100) ON CONFLICT DO NOTHING;`);
      const registry = new Registry();
      await createLedgerMetrics(
        registry,
        async () => (await pool.query(ledgerMetricsSql)).rows[0].snapshot
      )();
      const output = await registry.metrics();
      expect(output).toContain('orders_total{status="PARTIALLY_FILLED"} 1');
      expect(output).toContain('meridian_backtest_jobs_by_state{state="succeeded"} 1');
      expect(output).toContain('order_fill_latency_ms{quantile="0.95"} 195');
      expect(output).toContain(
        'meridian_order_fill_latency_samples{scope="latest-1000-persisted-fills"} 2'
      );
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  }
);
