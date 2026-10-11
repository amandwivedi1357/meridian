import type { MigrationRunResult, PostgresLikeClient } from "@meridian/db";
import { createPostgresMarketWriter } from "../adapters/postgres-market-writer-factory.js";
import { createRedisXadd, type RedisXaddClient } from "../adapters/redis-stream-adapter.js";
import { createInstrumentedIngestor } from "../market/instrumented-ingestor.js";
import { createMarketIngestor, type MarketIngestor } from "../market/market-ingestor-factory.js";
import type { SessionRecorder } from "../market/session-recorder.js";
import { runIngestorStartupMigrations } from "./startup-migrations.js";
import type { Registry } from "prom-client";
import { registerIngestorMetrics } from "./metrics.js";

export interface IngestorAppDeps {
  readonly redis: RedisXaddClient;
  readonly postgres: PostgresLikeClient;
  readonly metricsRegistry?: Registry;
  readonly sessionRecorder?: SessionRecorder;
}

export interface IngestorApp extends MarketIngestor {
  readonly start: () => Promise<MigrationRunResult>;
}

export function createIngestorApp(deps: IngestorAppDeps): IngestorApp {
  const metrics = deps.metricsRegistry
    ? registerIngestorMetrics({ registry: deps.metricsRegistry })
    : undefined;
  const marketWriter = createPostgresMarketWriter(deps.postgres);
  const marketIngestor = createMarketIngestor({
    xadd: createRedisXadd(deps.redis),
    upsertTrades: marketWriter.upsertTrades,
    upsertKlines: marketWriter.upsertKlines,
    ...(metrics ? { onPublished: metrics.recordBusLatency } : {}),
    ...(deps.sessionRecorder ? { sessionRecorder: deps.sessionRecorder } : {})
  });
  const ingestor = metrics ? createInstrumentedIngestor(marketIngestor, metrics) : marketIngestor;

  return {
    start() {
      return runIngestorStartupMigrations(deps.postgres);
    },

    ingest(input, receivedAtMs) {
      return ingestor.ingest(input, receivedAtMs);
    }
  };
}
