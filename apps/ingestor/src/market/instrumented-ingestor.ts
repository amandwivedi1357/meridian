import type { MarketIngestor } from "./market-ingestor-factory.js";
import type { IngestorMetrics } from "../runtime/metrics.js";

export function createInstrumentedIngestor(
  ingestor: MarketIngestor,
  metrics: IngestorMetrics
): MarketIngestor {
  return {
    async ingest(input) {
      try {
        const result = await ingestor.ingest(input);

        metrics.recordProcessed(result.event.kind);
        metrics.recordPublished(result.publishResult.stream);

        if (result.batchWriteResult.tradesWritten > 0) {
          metrics.recordPersisted("trades", result.batchWriteResult.tradesWritten);
        }

        if (result.batchWriteResult.klinesWritten > 0) {
          metrics.recordPersisted("klines", result.batchWriteResult.klinesWritten);
        }

        return result;
      } catch (error) {
        metrics.recordFailed("ingest_error");
        throw error;
      }
    }
  };
}
