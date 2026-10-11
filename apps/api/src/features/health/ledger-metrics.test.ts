import { Registry } from "@meridian/observability";
import { describe, expect, it, vi } from "vitest";
import { createLedgerMetrics } from "./ledger-metrics.js";

const empty = () => ({
  orders: [],
  jobs: [],
  fills: { count: "0", p50: null, p95: null, p99: null }
});
describe("durable ledger telemetry", () => {
  it.each([null, "", "9007199254740992", -1])(
    "rejects malformed or unsafe count %s instead of inventing zero",
    async (value) => {
      const registry = new Registry();
      await createLedgerMetrics(registry, async () => ({
        ...empty(),
        orders: [{ state: "NEW", count: value }]
      }))();
      expect(await registry.metrics()).not.toMatch(/orders_total\{status/);
    }
  );
  it("publishes known empty counts, not fictional fill latency; caches and clears failures", async () => {
    const registry = new Registry();
    let now = 100000;
    const read = vi.fn(async () => empty());
    const refresh = createLedgerMetrics(registry, read, () => now);
    expect(await registry.metrics()).toContain("meridian_ledger_sample_available 0");
    await refresh();
    await refresh();
    expect(read).toHaveBeenCalledTimes(1);
    expect(await registry.metrics()).toContain("meridian_ledger_sample_available 1");
    expect(await registry.metrics()).toContain('orders_total{status="FILLED"} 0');
    expect(await registry.metrics()).not.toMatch(/order_fill_latency_ms\{quantile/);
    now += 30001;
    read.mockRejectedValueOnce(new Error("db-secret"));
    await refresh();
    expect(await registry.metrics()).not.toMatch(/orders_total\{status/);
    expect(await registry.metrics()).not.toContain("db-secret");
    expect(await registry.metrics()).toContain("meridian_ledger_sample_available 0");
    now += 30001;
    await refresh();
    expect(await registry.metrics()).toContain("meridian_ledger_sample_available 1");
  });
  it("exports committed state populations and scoped fill quantiles without IDs", async () => {
    const registry = new Registry();
    const refresh = createLedgerMetrics(registry, async () => ({
      orders: [{ state: "UNKNOWN", count: "2" }],
      jobs: [{ state: "succeeded", count: "3" }],
      fills: { count: "4", p50: 10, p95: 20, p99: 30 }
    }));
    await refresh();
    const output = await registry.metrics();
    expect(output).toContain('orders_total{status="UNKNOWN"} 2');
    expect(output).toContain('meridian_backtest_jobs_by_state{state="succeeded"} 3');
    expect(output).toContain('order_fill_latency_ms{quantile="0.95"} 20');
    expect(output).not.toContain("clientOrderId");
  });
  it("coalesces concurrent reads and discards late or invalid samples", async () => {
    const registry = new Registry();
    let now = 100000;
    let resolve!: (value: unknown) => void;
    const read = vi.fn(
      () =>
        new Promise<unknown>((r) => {
          resolve = r;
        })
    );
    const refresh = createLedgerMetrics(registry, read, () => now);
    const a = refresh(),
      b = refresh();
    expect(a).toBe(b);
    now += 10001;
    resolve(empty());
    await a;
    expect(await registry.metrics()).not.toMatch(/orders_total\{status/);
    now += 30000;
    const c = refresh();
    resolve({ ...empty(), orders: [{ state: "secret", count: "1" }] });
    await c;
    expect(await registry.metrics()).not.toContain("secret");
  });
});
