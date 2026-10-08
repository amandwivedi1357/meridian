import { marketEventProtobufCodec, type EventCodec, type MarketEventMessage } from "@meridian/proto";
import { ingestMarketStreamEvent, type MarketIngestResult } from "./market-ingestor.js";
import { writeMarketEventBatch } from "./market-batch-writer.js";
import type { MarketBatchWriterDeps } from "./market-batch-writer.js";
import { publishNormalizedMarketEvent, type MarketEventPublisherDeps } from "./market-publisher.js";
import type { SessionRecorder } from "./session-recorder.js";

export interface MarketIngestorFactoryDeps
  extends Pick<MarketEventPublisherDeps, "xadd">, MarketBatchWriterDeps {
  readonly codec?: EventCodec<MarketEventMessage>;
  readonly sessionRecorder?: SessionRecorder;
}

export interface MarketIngestor {
  readonly ingest: (input: unknown) => Promise<MarketIngestResult>;
}

export function createMarketIngestor(deps: MarketIngestorFactoryDeps): MarketIngestor {
  const codec = deps.codec ?? marketEventProtobufCodec;

  return {
    ingest(input) {
      return ingestMarketStreamEvent(input, {
        publish(event) {
          return publishNormalizedMarketEvent(event, {
            encode: codec.encode,
            xadd: deps.xadd
          });
        },
        writeBatch(events) {
          return writeMarketEventBatch(events, {
            upsertTrades: deps.upsertTrades,
            upsertKlines: deps.upsertKlines
          });
        },
        ...(deps.sessionRecorder ? { sessionRecorder: deps.sessionRecorder } : {})
      });
    }
  };
}
