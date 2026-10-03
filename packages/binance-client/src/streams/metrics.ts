import { Gauge, type Registry } from "prom-client";
import type { StreamConnectionManager } from "./connection-manager.js";

export interface RegisterStreamMetricsOptions {
  readonly registry: Registry;
  readonly manager: StreamConnectionManager;
  readonly labels?: Record<string, string>;
}

export function registerStreamMetrics({
  registry,
  manager,
  labels = {}
}: RegisterStreamMetricsOptions) {
  const labelNames = Object.keys(labels);

  const reconnects = new Gauge({
    name: "ws_reconnects_total",
    help: "Total WebSocket reconnect attempts observed by the stream manager.",
    labelNames,
    registers: [registry]
  });

  const lastMessageAgeSeconds = new Gauge({
    name: "ws_last_message_age_seconds",
    help: "Age in seconds of the last WebSocket message received by the stream manager.",
    labelNames,
    registers: [registry]
  });

  return {
    collect() {
      reconnects.set(labels, manager.getReconnectCount());

      const lastMessageAgeMs = manager.getLastMessageAgeMs();

      if (lastMessageAgeMs !== undefined) {
        lastMessageAgeSeconds.set(labels, lastMessageAgeMs / 1000);
      }
    }
  };
}
