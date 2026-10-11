import { Counter, Histogram, type Registry } from "@meridian/observability";

export function createOrderSubmitMetrics(registry: Registry) {
  const duration = new Histogram({
    name: "order_submit_latency_ms",
    help: "Query-before-retry submission operation elapsed time after safety guards, including errors; not fill latency",
    registers: [registry],
    buckets: [10, 50, 100, 250, 500, 1000, 3000, 10000]
  });
  const operations = new Counter({
    name: "meridian_order_submit_operations_total",
    help: "Submit operations resolved or errored; resolved can be a recovered existing order, not a new placement",
    labelNames: ["outcome"],
    registers: [registry]
  });
  return async function measure<T>(run: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      const result = await run();
      operations.inc({ outcome: "resolved" });
      return result;
    } catch (error) {
      operations.inc({ outcome: "error" });
      throw error;
    } finally {
      duration.observe(performance.now() - start);
    }
  };
}
