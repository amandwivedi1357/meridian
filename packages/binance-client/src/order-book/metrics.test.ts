import { Registry } from "prom-client";
import { describe, expect, it } from "vitest";
import type { DepthSyncOrchestrator } from "./depth-sync-orchestrator.js";
import { registerOrderBookMetrics } from "./metrics.js";

describe("registerOrderBookMetrics", () => {
  it("collects resync count and update lag", async () => {
    const registry = new Registry();
    const orchestrator = {
      getResyncCount: () => 2,
      getUpdateLagMs: () => 1_500
    } as DepthSyncOrchestrator;
    const metrics = registerOrderBookMetrics({
      registry,
      orchestrator,
      labels: { symbol: "BTCUSDT" }
    });

    metrics.collect();

    const output = await registry.metrics();

    expect(output).toContain(
      'order_book_resyncs_total{symbol="BTCUSDT"} 2'
    );
    expect(output).toContain(
      'order_book_update_lag_seconds{symbol="BTCUSDT"} 1.5'
    );
  });
});
