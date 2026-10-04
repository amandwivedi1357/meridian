import type { KlineBackfillResult } from "../backfill/kline-backfill-runner.js";
import type { LiveIngestSmokeResult } from "../smoke/live-ingest-smoke.js";
import type { RedisPublishSmokeResult } from "../smoke/redis-publish-smoke.js";
import { parseIngestorMainMode } from "./main-mode.js";

export interface LiveIngestResult {
  readonly kind: "live-started";
}

export interface IngestorMainRunnerDeps {
  readonly runLive: () => Promise<LiveIngestResult>;
  readonly runBackfillKlines: (args: readonly string[]) => Promise<KlineBackfillResult>;
  readonly runRedisPublishSmoke: () => Promise<RedisPublishSmokeResult>;
  readonly runLiveIngestSmoke: (args: readonly string[]) => Promise<LiveIngestSmokeResult>;
}

export type IngestorMainResult =
  LiveIngestResult | KlineBackfillResult | RedisPublishSmokeResult | LiveIngestSmokeResult;

export function runIngestorMain(
  args: readonly string[],
  deps: IngestorMainRunnerDeps
): Promise<IngestorMainResult> {
  const mode = parseIngestorMainMode(args);

  switch (mode.kind) {
    case "live":
      return deps.runLive();

    case "backfill-klines":
      return deps.runBackfillKlines(mode.args);

    case "smoke-redis-publish":
      return deps.runRedisPublishSmoke();

    case "smoke-live-ingest":
      return deps.runLiveIngestSmoke(mode.args);
  }
}
