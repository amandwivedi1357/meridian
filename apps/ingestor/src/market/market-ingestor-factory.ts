import { encodeMarketEvent } from "@meridian/proto";
import {
  ingestMarketStreamEvent,
  type MarketIngestResult
} from "./market-ingestor.js";
import { writeMarketEventBatch } from "./market-batch-writer.js";
import type { MarketBatchWriterDeps } from "./market-batch-writer.js";
import {
  publishNormalizedMarketEvent,
  type MarketEventPublisherDeps
} from "./market-publisher.js";

export interface MarketIngestorFactoryDeps
  extends Pick<MarketEventPublisherDeps, "xadd">,
    MarketBatchWriterDeps {}

export interface MarketIngestor {
  readonly ingest: (input: unknown) => Promise<MarketIngestResult>;
}

export function createMarketIngestor(
  deps: MarketIngestorFactoryDeps
): MarketIngestor {
  return {
    ingest(input) {
      return ingestMarketStreamEvent(input, {
        publish(event) {
          return publishNormalizedMarketEvent(event, {
            encode: encodeMarketEvent,
            xadd: deps.xadd
          });
        },
        writeBatch(events) {
          return writeMarketEventBatch(events, {
            upsertTrades: deps.upsertTrades,
            upsertKlines: deps.upsertKlines
          });
        }
      });
    }
  };
}