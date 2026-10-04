import { normalizeMarketStreamEvent, type NormalizedMarketEvent } from "./market-events.js";
import type { MarketBatchWriteResult } from "./market-batch-writer.js";
import type { PublishedMarketEvents } from "./market-publisher.js";
import type { SessionRecorder } from "./session-recorder.js";

export interface MarketIngestorDeps {
  readonly publish: (event: NormalizedMarketEvent) => Promise<PublishedMarketEvents>;
  readonly writeBatch: (
    events: readonly NormalizedMarketEvent[]
  ) => Promise<MarketBatchWriteResult>;
  readonly sessionRecorder?: SessionRecorder;
}

export interface MarketIngestResult {
  readonly event: NormalizedMarketEvent;
  readonly publishResult: PublishedMarketEvents;
  readonly batchWriteResult: MarketBatchWriteResult;
}

export async function ingestMarketStreamEvent(
  input: unknown,
  deps: MarketIngestorDeps
): Promise<MarketIngestResult> {
  const event = normalizeMarketStreamEvent(input);
  await deps.sessionRecorder?.record(event);
  const publishResult = await deps.publish(event);
  const batchWriteResult = await deps.writeBatch([event]);

  return {
    event,
    publishResult,
    batchWriteResult
  };
}
