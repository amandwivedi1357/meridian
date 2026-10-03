import { describe, expect, it, vi } from "vitest";
import { createInstrumentedIngestor } from "../instrumented-ingestor.js";

describe("createInstrumentedIngestor", () => {
  it("records metrics around successful ingestion", async () => {
    const ingest = vi.fn(async () => ({
      event: {
        kind: "trade" as const,
        symbol: "BTCUSDT",
        eventId: "12345",
        occurredAtMs: 1_700_000_000_000,
        trade: {} as never
      },
      publishResult: {
        stream: "market.trade.BTCUSDT",
        id: "1700000000000-0"
      },
      batchWriteResult: {
        tradesWritten: 1,
        klinesWritten: 0,
        duplicatesSkipped: 0
      }
    }));
    const metrics = {
      recordProcessed: vi.fn(),
      recordFailed: vi.fn(),
      recordPublished: vi.fn(),
      recordPersisted: vi.fn()
    };
    const ingestor = createInstrumentedIngestor({ ingest }, metrics);

    await ingestor.ingest({ raw: true });

    expect(metrics.recordProcessed).toHaveBeenCalledWith("trade");
    expect(metrics.recordPublished).toHaveBeenCalledWith("market.trade.BTCUSDT");
    expect(metrics.recordPersisted).toHaveBeenCalledWith("trades", 1);
    expect(metrics.recordPersisted).not.toHaveBeenCalledWith("klines", 0);
    expect(metrics.recordFailed).not.toHaveBeenCalled();
  });

  it("records failed metrics and rethrows ingestion errors", async () => {
    const error = new Error("bad event");
    const ingest = vi.fn(async () => {
      throw error;
    });
    const metrics = {
      recordProcessed: vi.fn(),
      recordFailed: vi.fn(),
      recordPublished: vi.fn(),
      recordPersisted: vi.fn()
    };
    const ingestor = createInstrumentedIngestor({ ingest }, metrics);

    await expect(ingestor.ingest({ raw: true })).rejects.toThrow(error);

    expect(metrics.recordFailed).toHaveBeenCalledWith("ingest_error");
    expect(metrics.recordProcessed).not.toHaveBeenCalled();
    expect(metrics.recordPublished).not.toHaveBeenCalled();
    expect(metrics.recordPersisted).not.toHaveBeenCalled();
  });
});
