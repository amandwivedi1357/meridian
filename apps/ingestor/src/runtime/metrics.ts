import { Counter, type Registry } from "prom-client";

export interface IngestorMetricsDeps {
  readonly registry: Registry;
}

export interface IngestorMetrics {
  readonly recordProcessed: (kind: string) => void;
  readonly recordFailed: (reason: string) => void;
  readonly recordPublished: (stream: string) => void;
  readonly recordPersisted: (target: string, count: number) => void;
}

export function registerIngestorMetrics(
  deps: IngestorMetricsDeps
): IngestorMetrics {
  const processed = new Counter({
    name: "ingestor_events_processed_total",
    help: "Total market events successfully normalized by the ingestor.",
    labelNames: ["kind"],
    registers: [deps.registry]
  });

  const failed = new Counter({
    name: "ingestor_events_failed_total",
    help: "Total market events rejected or failed by the ingestor.",
    labelNames: ["reason"],
    registers: [deps.registry]
  });

  const published = new Counter({
    name: "ingestor_events_published_total",
    help: "Total market events published to Redis Streams.",
    labelNames: ["stream"],
    registers: [deps.registry]
  });

  const persisted = new Counter({
    name: "ingestor_events_persisted_total",
    help: "Total market rows persisted by the ingestor.",
    labelNames: ["target"],
    registers: [deps.registry]
  });

  return {
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