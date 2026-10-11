import { Gauge, type Registry } from "@meridian/observability";
import type { HealthReader } from "./system-health.js";

export function instrumentStorageHealth(read: HealthReader, registry: Registry): HealthReader {
  const dependencies = new Gauge({
    name: "meridian_dependency_available",
    help: "API-observed dependency availability",
    labelNames: ["dependency"],
    registers: [registry]
  });
  const sampled = new Gauge({
    name: "meridian_storage_sample_timestamp_seconds",
    help: "Timestamp of underlying cached storage health sample",
    registers: [registry]
  });
  const available = new Gauge({
    name: "meridian_stream_available",
    help: "Configured Redis stream exists and can be inspected",
    labelNames: ["stream"],
    registers: [registry]
  });
  const length = new Gauge({
    name: "meridian_stream_length",
    help: "Retained entries, not total lifetime events",
    labelNames: ["stream"],
    registers: [registry]
  });
  const lag = new Gauge({
    name: "bus_consumer_lag",
    help: "Undelivered entries for configured engine/executor groups; absent when unknown",
    labelNames: ["stream", "group"],
    registers: [registry]
  });
  const pending = new Gauge({
    name: "bus_pending_entries",
    help: "Unacknowledged entries for configured engine/executor groups",
    labelNames: ["stream", "group"],
    registers: [registry]
  });
  function clearStreams() {
    available.reset();
    length.reset();
    lag.reset();
    pending.reset();
  }
  return async () => {
    try {
      const sample = await read();
      clearStreams();
      dependencies.set({ dependency: "redis" }, sample.redis === "available" ? 1 : 0);
      dependencies.set({ dependency: "timescaledb" }, sample.database === "available" ? 1 : 0);
      sampled.set(sample.checkedAt / 1000);
      for (const stream of sample.streams) {
        available.set({ stream: stream.stream }, stream.status === "available" ? 1 : 0);
        if (stream.status !== "available") continue;
        if (stream.length !== null) length.set({ stream: stream.stream }, stream.length);
        for (const group of stream.groups) {
          // Runtime group names are fixed; do not export arbitrary user-created labels.
          if (group.name !== "engine" && group.name !== "executor") continue;
          const labels = { stream: stream.stream, group: group.name };
          pending.set(labels, group.pending);
          if (group.lag !== null) lag.set(labels, group.lag);
        }
      }
      return sample;
    } catch (error) {
      clearStreams();
      sampled.reset();
      dependencies.set({ dependency: "redis" }, 0);
      dependencies.set({ dependency: "timescaledb" }, 0);
      throw error;
    }
  };
}
