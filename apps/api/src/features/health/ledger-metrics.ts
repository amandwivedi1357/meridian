import { Gauge, type Registry } from "@meridian/observability";
import { ORDER_STATES } from "@meridian/core";
import { z } from "zod";

const count = z
  .union([z.string().regex(/^\d+$/), z.number()])
  .pipe(z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
const snapshot = z.object({
  orders: z.array(z.object({ state: z.enum(ORDER_STATES), count })),
  jobs: z.array(z.object({ state: z.enum(["queued", "running", "succeeded", "failed"]), count })),
  fills: z.object({
    count,
    p50: z.number().finite().nonnegative().nullable(),
    p95: z.number().finite().nonnegative().nullable(),
    p99: z.number().finite().nonnegative().nullable()
  })
});

export const ledgerMetricsSql = `
WITH recent_fills AS (
  SELECT client_order_id, event_time_ms FROM order_fills
  ORDER BY event_time_ms DESC, client_order_id, execution_id LIMIT 1000
), latency AS (
  SELECT (f.event_time_ms - EXTRACT(EPOCH FROM o.created_at)*1000)::double precision AS ms
  FROM recent_fills f JOIN orders o USING (client_order_id)
  WHERE f.event_time_ms >= EXTRACT(EPOCH FROM o.created_at)*1000
)
SELECT jsonb_build_object(
  'orders', COALESCE((SELECT jsonb_agg(t) FROM (SELECT state, COUNT(*)::text AS count FROM orders GROUP BY state) t), '[]'::jsonb),
  'jobs', COALESCE((SELECT jsonb_agg(t) FROM (SELECT state, COUNT(*)::text AS count FROM backtest_jobs GROUP BY state) t), '[]'::jsonb),
  'fills', (SELECT jsonb_build_object('count', COUNT(*)::text,
    'p50', percentile_cont(0.5) WITHIN GROUP (ORDER BY ms),
    'p95', percentile_cont(0.95) WITHIN GROUP (ORDER BY ms),
    'p99', percentile_cont(0.99) WITHIN GROUP (ORDER BY ms)) FROM latency)
) AS snapshot`;

export function createLedgerMetrics(
  registry: Registry,
  read: () => Promise<unknown>,
  now = Date.now
) {
  const orders = new Gauge({
    name: "orders_total",
    help: "Current persisted order population by state; gauge, not transition counter",
    labelNames: ["status"],
    registers: [registry]
  });
  const jobs = new Gauge({
    name: "meridian_backtest_jobs_by_state",
    help: "Durable job populations; succeeded is committed result, not process exit",
    labelNames: ["state"],
    registers: [registry]
  });
  const fills = new Gauge({
    name: "order_fill_latency_ms",
    help: "Persisted fill event minus local order creation; quantiles over latest 1000 fills, includes partial executions",
    labelNames: ["quantile"],
    registers: [registry]
  });
  const samples = new Gauge({
    name: "meridian_order_fill_latency_samples",
    help: "Nonnegative latency samples among latest 1000 persisted fills",
    labelNames: ["scope"],
    registers: [registry]
  });
  const timestamp = new Gauge({
    name: "meridian_ledger_sample_timestamp_seconds",
    help: "Last successful durable ledger snapshot",
    labelNames: ["scope"],
    registers: [registry]
  });
  const available = new Gauge({
    name: "meridian_ledger_sample_available",
    help: "Latest durable ledger sample validated successfully; zero on failed or unobserved sample",
    registers: [registry]
  });
  available.set(0);
  let pending: Promise<void> | undefined;
  let lastAttempt = -Infinity;
  return () => {
    if (pending) return pending;
    if (now() - lastAttempt < 30000) return Promise.resolve();
    lastAttempt = now();
    pending = (async () => {
      try {
        const result = snapshot.parse(await read());
        if (now() - lastAttempt < 0 || now() - lastAttempt > 10000)
          throw new Error("Stale ledger sample");
        orders.reset();
        jobs.reset();
        fills.reset();
        samples.reset();
        timestamp.reset();
        for (const status of ORDER_STATES)
          orders.set({ status }, result.orders.find((r) => r.state === status)?.count ?? 0);
        for (const state of ["queued", "running", "succeeded", "failed"])
          jobs.set({ state }, result.jobs.find((r) => r.state === state)?.count ?? 0);
        for (const [quantile, value] of [
          ["0.5", result.fills.p50],
          ["0.95", result.fills.p95],
          ["0.99", result.fills.p99]
        ] as const)
          if (value !== null) fills.set({ quantile }, value);
        samples.set({ scope: "latest-1000-persisted-fills" }, result.fills.count);
        timestamp.set({ scope: "persisted-ledger" }, now() / 1000);
        available.set(1);
      } catch {
        available.set(0);
        orders.reset();
        jobs.reset();
        fills.reset();
        samples.reset();
        timestamp.reset();
      }
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
