import { Registry } from "prom-client";
import { describe, expect, it } from "vitest";
import { registerIngestorMetrics } from "../metrics.js";

describe("registerIngestorMetrics", () => {
  it("records successful bus timing and rejects invalid durations across retries", async () => {
    const registry = new Registry();
    const first = registerIngestorMetrics({ registry });
    first.recordBusLatency("trade", 12);
    first.recordBusLatency("trade", -1);
    first.recordBusLatency("trade", Number.NaN);
    registerIngestorMetrics({ registry }).recordBusLatency("trade", 8);
    expect(await registry.metrics()).toContain('ingest_to_bus_latency_ms_count{kind="trade"} 2');
    expect(await registry.metrics()).toContain('ingest_to_bus_latency_ms_sum{kind="trade"} 20');
  });
  it("shares collectors and retains counts across supervisor retries", async () => {
    const registry = new Registry();
    registerIngestorMetrics({ registry }).recordProcessed("trade");
    registerIngestorMetrics({ registry }).recordProcessed("trade");
    expect(await registry.metrics()).toContain('ingestor_events_processed_total{kind="trade"} 2');
  });
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
