import type {
  StreamConnectionEventHandler,
  StreamConnectionManager,
  StreamMessage,
  StreamMessageHandler
} from "@meridian/binance-client";
import { describe, expect, it, vi } from "vitest";
import { parseLiveIngestSmokeArgs, runLiveIngestSmoke } from "../live-ingest-smoke.js";

class FakeStreamManager implements StreamConnectionManager {
  readonly messages: StreamMessageHandler[] = [];
  readonly stateChanges: StreamConnectionEventHandler[] = [];
  readonly connect = vi.fn();
  readonly close = vi.fn();
  readonly checkStale = vi.fn();
  readonly calculateReconnectDelayForAttempt = vi.fn(() => 0);
  readonly getLastPingAtMs = vi.fn(() => undefined);
  readonly getLastPongAtMs = vi.fn(() => undefined);
  readonly getState = vi.fn(() => "OPEN" as const);
  readonly getSubscriptions = vi.fn(() => []);
  readonly transitionTo = vi.fn();
  readonly getLastMessageAgeMs = vi.fn(() => undefined);
  readonly getLastMessageAtMs = vi.fn(() => undefined);
  readonly getReconnectCount = vi.fn(() => 0);

  onMessage(handler: StreamMessageHandler): () => void {
    this.messages.push(handler);
    return () => undefined;
  }

  onStateChange(handler: StreamConnectionEventHandler): () => void {
    this.stateChanges.push(handler);
    return () => undefined;
  }

  emit(message: StreamMessage): void {
    for (const handler of this.messages) {
      handler(message);
    }
  }
}

describe("parseLiveIngestSmokeArgs", () => {
  it("defaults to a short BTCUSDT production smoke", () => {
    expect(parseLiveIngestSmokeArgs([])).toEqual({
      symbol: "BTCUSDT",
      maxEvents: 3,
      timeoutMs: 10_000,
      environment: "production"
    });
  });

  it("parses optional smoke settings", () => {
    expect(
      parseLiveIngestSmokeArgs([
        "--symbol",
        "ETHUSDT",
        "--events",
        "2",
        "--timeoutMs",
        "5000",
        "--environment",
        "testnet"
      ])
    ).toEqual({
      symbol: "ETHUSDT",
      maxEvents: 2,
      timeoutMs: 5000,
      environment: "testnet"
    });
  });

  it("rejects invalid settings", () => {
    expect(() => parseLiveIngestSmokeArgs(["--events", "0"])).toThrow();
    expect(() => parseLiveIngestSmokeArgs(["--environment", "paper"])).toThrow();
  });
});

describe("runLiveIngestSmoke", () => {
  it("ingests stream messages until the max event count is reached", async () => {
    const manager = new FakeStreamManager();
    const ingest = vi.fn(async () => ({
      event: {} as never,
      publishResult: {
        stream: "market.trade.BTCUSDT",
        id: "1-0"
      },
      batchWriteResult: {
        tradesWritten: 1,
        klinesWritten: 0,
        duplicatesSkipped: 0
      }
    }));

    const resultPromise = runLiveIngestSmoke(["--events", "2"], {
      ingestor: { ingest },
      createStreamManager: () => manager
    });

    manager.emit({
      stream: "btcusdt@trade",
      data: {
        e: "trade",
        E: 1,
        s: "BTCUSDT",
        t: 1,
        p: "100",
        q: "0.1",
        b: 1,
        a: 1,
        T: 1,
        m: false,
        M: true
      }
    });
    manager.emit({
      stream: "btcusdt@trade",
      data: {
        e: "trade",
        E: 2,
        s: "BTCUSDT",
        t: 2,
        p: "101",
        q: "0.2",
        b: 2,
        a: 2,
        T: 2,
        m: true,
        M: true
      }
    });

    await expect(resultPromise).resolves.toEqual({
      kind: "live-ingest-smoke-completed",
      symbol: "BTCUSDT",
      eventsReceived: 2,
      eventsIngested: 2,
      timedOut: false
    });
    expect(ingest).toHaveBeenCalledTimes(2);
    expect(manager.connect).toHaveBeenCalledOnce();
    expect(manager.close).toHaveBeenCalledOnce();
  });

  it("returns a timeout result when no enough events arrive", async () => {
    vi.useFakeTimers();
    const manager = new FakeStreamManager();

    try {
      const resultPromise = runLiveIngestSmoke(["--timeoutMs", "1000"], {
        ingestor: {
          ingest: vi.fn()
        },
        createStreamManager: () => manager
      });

      await vi.advanceTimersByTimeAsync(1000);

      await expect(resultPromise).resolves.toEqual({
        kind: "live-ingest-smoke-completed",
        symbol: "BTCUSDT",
        eventsReceived: 0,
        eventsIngested: 0,
        timedOut: true
      });
      expect(manager.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
