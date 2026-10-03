import type { KlineBackfillResult } from "../backfill/kline-backfill-runner.js";
import { parseIngestorMainMode } from "./main-mode.js";

export interface LiveIngestResult {
  readonly kind: "live-started";
}

export interface IngestorMainRunnerDeps {
  readonly runLive: () => Promise<LiveIngestResult>;
  readonly runBackfillKlines: (
    args: readonly string[]
  ) => Promise<KlineBackfillResult>;
}

export type IngestorMainResult = LiveIngestResult | KlineBackfillResult;

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
  }
}