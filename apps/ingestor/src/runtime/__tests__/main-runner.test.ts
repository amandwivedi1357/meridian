import { describe, expect, it, vi } from "vitest";
import { runIngestorMain } from "../main-runner.js";

describe("runIngestorMain", () => {
  it("runs live mode by default", async () => {
    const runLive = vi.fn(async () => ({ kind: "live-started" as const }));
    const runBackfillKlines = vi.fn(async () => ({
      requestsPlanned: 0,
      requestsCompleted: 0,
      candlesWritten: 0
    }));
    const runRedisPublishSmoke = vi.fn(async () => ({
      stream: "market.trade.BTCUSDT",
      id: "1-0",
      eventId: "smoke:1"
    }));
    const runLiveIngestSmoke = vi.fn(async () => ({
      kind: "live-ingest-smoke-completed" as const,
      symbol: "BTCUSDT",
      eventsReceived: 1,
      eventsIngested: 1,
      timedOut: false
    }));

    const result = await runIngestorMain([], {
      runLive,
      runBackfillKlines,
      runRedisPublishSmoke,
      runLiveIngestSmoke
    });

    expect(runLive).toHaveBeenCalledOnce();
    expect(runBackfillKlines).not.toHaveBeenCalled();
    expect(runRedisPublishSmoke).not.toHaveBeenCalled();
    expect(runLiveIngestSmoke).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "live-started" });
  });

  it("runs kline backfill mode with remaining args", async () => {
    const runLive = vi.fn(async () => ({ kind: "live-started" as const }));
    const runBackfillKlines = vi.fn(async () => ({
      requestsPlanned: 1,
      requestsCompleted: 1,
      candlesWritten: 10
    }));
    const runRedisPublishSmoke = vi.fn(async () => ({
      stream: "market.trade.BTCUSDT",
      id: "1-0",
      eventId: "smoke:1"
    }));
    const runLiveIngestSmoke = vi.fn(async () => ({
      kind: "live-ingest-smoke-completed" as const,
      symbol: "BTCUSDT",
      eventsReceived: 1,
      eventsIngested: 1,
      timedOut: false
    }));

    const result = await runIngestorMain(["backfill-klines", "--symbol", "BTCUSDT"], {
      runLive,
      runBackfillKlines,
      runRedisPublishSmoke,
      runLiveIngestSmoke
    });

    expect(runLive).not.toHaveBeenCalled();
    expect(runBackfillKlines).toHaveBeenCalledWith(["--symbol", "BTCUSDT"]);
    expect(runRedisPublishSmoke).not.toHaveBeenCalled();
    expect(runLiveIngestSmoke).not.toHaveBeenCalled();
    expect(result).toEqual({
      requestsPlanned: 1,
      requestsCompleted: 1,
      candlesWritten: 10
    });
  });

  it("runs Redis publish smoke mode", async () => {
    const runLive = vi.fn(async () => ({ kind: "live-started" as const }));
    const runBackfillKlines = vi.fn(async () => ({
      requestsPlanned: 0,
      requestsCompleted: 0,
      candlesWritten: 0
    }));
    const runRedisPublishSmoke = vi.fn(async () => ({
      stream: "market.trade.BTCUSDT",
      id: "1-0",
      eventId: "smoke:1"
    }));
    const runLiveIngestSmoke = vi.fn(async () => ({
      kind: "live-ingest-smoke-completed" as const,
      symbol: "BTCUSDT",
      eventsReceived: 1,
      eventsIngested: 1,
      timedOut: false
    }));

    const result = await runIngestorMain(["smoke-redis-publish"], {
      runLive,
      runBackfillKlines,
      runRedisPublishSmoke,
      runLiveIngestSmoke
    });

    expect(runLive).not.toHaveBeenCalled();
    expect(runBackfillKlines).not.toHaveBeenCalled();
    expect(runRedisPublishSmoke).toHaveBeenCalledOnce();
    expect(runLiveIngestSmoke).not.toHaveBeenCalled();
    expect(result).toEqual({
      stream: "market.trade.BTCUSDT",
      id: "1-0",
      eventId: "smoke:1"
    });
  });

  it("runs live ingest smoke mode with remaining args", async () => {
    const runLive = vi.fn(async () => ({ kind: "live-started" as const }));
    const runBackfillKlines = vi.fn(async () => ({
      requestsPlanned: 0,
      requestsCompleted: 0,
      candlesWritten: 0
    }));
    const runRedisPublishSmoke = vi.fn(async () => ({
      stream: "market.trade.BTCUSDT",
      id: "1-0",
      eventId: "smoke:1"
    }));
    const runLiveIngestSmoke = vi.fn(async () => ({
      kind: "live-ingest-smoke-completed" as const,
      symbol: "ETHUSDT",
      eventsReceived: 2,
      eventsIngested: 2,
      timedOut: false
    }));

    const result = await runIngestorMain(
      ["smoke-live-ingest", "--symbol", "ETHUSDT", "--events", "2"],
      {
        runLive,
        runBackfillKlines,
        runRedisPublishSmoke,
        runLiveIngestSmoke
      }
    );

    expect(runLive).not.toHaveBeenCalled();
    expect(runBackfillKlines).not.toHaveBeenCalled();
    expect(runRedisPublishSmoke).not.toHaveBeenCalled();
    expect(runLiveIngestSmoke).toHaveBeenCalledWith(["--symbol", "ETHUSDT", "--events", "2"]);
    expect(result).toEqual({
      kind: "live-ingest-smoke-completed",
      symbol: "ETHUSDT",
      eventsReceived: 2,
      eventsIngested: 2,
      timedOut: false
    });
  });
});
