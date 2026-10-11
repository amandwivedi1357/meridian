import { Registry } from "@meridian/observability";
import { expect, it } from "vitest";
import { createOrderSubmitMetrics } from "./order-submit-metrics.js";

it("measures resolved and failed operations without changing results or retrying", async () => {
  const registry = new Registry();
  const measure = createOrderSubmitMetrics(registry);
  const result = { existingOrder: true };
  expect(await measure(async () => result)).toBe(result);
  const error = new Error("private-id");
  await expect(
    measure(async () => {
      throw error;
    })
  ).rejects.toBe(error);
  const metrics = await registry.metrics();
  expect(metrics).toContain('meridian_order_submit_operations_total{outcome="resolved"} 1');
  expect(metrics).toContain('meridian_order_submit_operations_total{outcome="error"} 1');
  expect(metrics).toContain("order_submit_latency_ms_count 2");
  expect(metrics).not.toContain("private-id");
});
