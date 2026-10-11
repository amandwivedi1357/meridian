import { Counter, Histogram, type Registry } from "prom-client";

export interface IngestorMetricsDeps {
  readonly registry: Registry;
}

export interface IngestorMetrics {
  readonly recordBusLatency: (kind: string, elapsedMs: number) => void;
  readonly recordProcessed: (kind: string) => void;
  readonly recordFailed: (reason: string) => void;
  readonly recordPublished: (stream: string) => void;
  readonly recordPersisted: (target: string, count: number) => void;
}

export function registerIngestorMetrics(deps: IngestorMetricsDeps): IngestorMetrics {
  const busLatency =
    (deps.registry.getSingleMetric("ingest_to_bus_latency_ms") as Histogram | undefined) ??
    new Histogram({
      name: "ingest_to_bus_latency_ms",
      help: "Local receipt/ingest entry to successful Redis publication, including queue/recording but excluding DB write",
      labelNames: ["kind"],
      buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000],
      registers: [deps.registry]
    });
  const processed =
    (deps.registry.getSingleMetric("ingestor_events_processed_total") as Counter | undefined) ??
    new Counter({
      name: "ingestor_events_processed_total",
      help: "Total market events successfully normalized by the ingestor.",
      labelNames: ["kind"],
      registers: [deps.registry]
    });

  const failed =
    (deps.registry.getSingleMetric("ingestor_events_failed_total") as Counter | undefined) ??
    new Counter({
      name: "ingestor_events_failed_total",
      help: "Total market events rejected or failed by the ingestor.",
      labelNames: ["reason"],
      registers: [deps.registry]
    });

  const published =
    (deps.registry.getSingleMetric("ingestor_events_published_total") as Counter | undefined) ??
    new Counter({
      name: "ingestor_events_published_total",
      help: "Total market events published to Redis Streams.",
      labelNames: ["stream"],
      registers: [deps.registry]
    });

  const persisted =
    (deps.registry.getSingleMetric("ingestor_events_persisted_total") as Counter | undefined) ??
    new Counter({
      name: "ingestor_events_persisted_total",
      help: "Total market rows persisted by the ingestor.",
      labelNames: ["target"],
      registers: [deps.registry]
    });

  return {
    recordBusLatency(kind, elapsedMs) {
      if (Number.isFinite(elapsedMs) && elapsedMs >= 0) busLatency.observe({ kind }, elapsedMs);
    },
    recordProcessed(kind) {
      processed.inc({ kind });
    },

    recordFailed(reason) {
      failed.inc({ reason });
    },

    recordPublished(stream) {
      published.inc({ stream });
    },

    recordPersisted(target, count) {
      persisted.inc({ target }, count);
    }
  };
}
