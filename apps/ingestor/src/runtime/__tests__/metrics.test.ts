import { Registry } from "prom-client";
import { describe, expect, it } from "vitest";
import { registerIngestorMetrics } from "../metrics.js";

describe("registerIngestorMetrics", () => {
  it("registers counters for processed, failed, published, and persisted market events", async () => {
    const registry = new Registry();
    const metrics = registerIngestorMetrics({ registry });

    metrics.recordProcessed("trade");
    metrics.recordFailed("validation");
    metrics.recordPublished("market.trade.BTCUSDT");
    metrics.recordPersisted("trades", 2);

    const output = await registry.metrics();

    expect(output).toContain('ingestor_events_processed_total{kind="trade"} 1');
    expect(output).toContain('ingestor_events_failed_total{reason="validation"} 1');
    expect(output).toContain('ingestor_events_published_total{stream="market.trade.BTCUSDT"} 1');
    expect(output).toContain('ingestor_events_persisted_total{target="trades"} 2');
  });
});
