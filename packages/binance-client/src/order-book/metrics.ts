import { Gauge, type Registry } from "prom-client";
import type { DepthSyncOrchestrator } from "./depth-sync-orchestrator.js";

export interface RegisterOrderBookMetricsOptions {
  readonly registry: Registry;
  readonly orchestrator: DepthSyncOrchestrator;
  readonly labels?: Record<string, string>;
}

export function registerOrderBookMetrics({
  registry,
  orchestrator,
  labels = {}
}: RegisterOrderBookMetricsOptions) {
  const labelNames = Object.keys(labels);

  const resyncs = new Gauge({
    name: "order_book_resyncs_total",
    help: "Total local order book resyncs triggered after sequence gaps.",
    labelNames,
    registers: [registry]
  });

  const updateLagSeconds = new Gauge({
    name: "order_book_update_lag_seconds",
    help: "Age in seconds of the latest local order book update.",
    labelNames,
    registers: [registry]
  });

  return {
    collect() {
      resyncs.set(labels, orchestrator.getResyncCount());

      const updateLagMs = orchestrator.getUpdateLagMs();

      if (updateLagMs !== undefined) {
        updateLagSeconds.set(labels, updateLagMs / 1000);
      }
    }
  };
}
