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
  const marketWriter = createPostgresMarketWriter(deps.postgres);
  const marketIngestor = createMarketIngestor({
    xadd: createRedisXadd(deps.redis),
    upsertTrades: marketWriter.upsertTrades,
    upsertKlines: marketWriter.upsertKlines,
    ...(deps.sessionRecorder ? { sessionRecorder: deps.sessionRecorder } : {})
  });
  const ingestor = deps.metricsRegistry
    ? createInstrumentedIngestor(
        marketIngestor,
        registerIngestorMetrics({ registry: deps.metricsRegistry })
      )
    : marketIngestor;

  return {
    start() {
      return runIngestorStartupMigrations(deps.postgres);
    },

    ingest(input) {
      return ingestor.ingest(input);
    }
  };
}
