import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Registry } from "@meridian/observability";
import { EventEmitter } from "node:events";
import type * as BinanceClient from "@meridian/binance-client";
import { createMarketIngestor } from "../market/market-ingestor-factory.js";

const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  connect: vi.fn(),
  destroy: vi.fn(),
  close: vi.fn(),
  start: vi.fn(),
  ingest: vi.fn(),
  drain: vi.fn(),
  socketConnect: vi.fn(),
  socketClose: vi.fn(),
  ageMs: 1 as number | undefined,
  message: undefined as undefined | ((message: { data: string }) => void),
  state: undefined as undefined | ((event: { state: string }) => void),
  reconnect: undefined as undefined | (() => void),
  useRealManager: false,
  sockets: [] as (EventEmitter & { close: () => void })[],
  socketUrls: [] as string[]
}));
vi.mock("pg", () => ({
  Pool: class {
    on() {}
  }
}));
vi.mock("redis", () => ({
  createClient: () => ({
    on() {},
    connect: mocks.connect,
    destroy: mocks.destroy,
    isOpen: true,
    isReady: true,
    withAbortSignal: () => ({ sendCommand: mocks.command })
  })
}));
vi.mock("./config.js", () => ({
  loadIngestorConfig: () => ({ redisUrl: "redis://localhost", postgresUrl: "postgres://localhost" })
}));
vi.mock("./runtime-clients.js", () => ({
  createRuntimeClients: () => ({ redis: { connect: mocks.connect }, close: mocks.close })
}));
vi.mock("./app-bootstrap.js", () => ({
  createIngestorApp: () => ({ start: mocks.start, ingest: mocks.ingest, drain: mocks.drain })
}));
vi.mock("@meridian/binance-client", async (importOriginal) => {
  const actual = await importOriginal<typeof BinanceClient>();
  return {
    tradeStream: actual.tradeStream,
    depthStream: actual.depthStream,
    klineStream: actual.klineStream,
    createStreamConnectionManager: (
      options: Parameters<typeof actual.createStreamConnectionManager>[0]
    ) => {
      if (mocks.useRealManager)
        return actual.createStreamConnectionManager({
          ...options,
          createWebSocket: (url) => {
            mocks.socketUrls.push(url);
            const socket = mocks.sockets.shift();
            if (!socket) throw new Error("unexpected_test_socket");
            return socket as unknown as ReturnType<NonNullable<typeof options.createWebSocket>>;
          }
        });
      mocks.reconnect = options.onReconnect;
      return {
        connect: mocks.socketConnect,
        close: mocks.socketClose,
        onMessage: (handler: typeof mocks.message) => {
          mocks.message = handler;
        },
        onStateChange: (handler: typeof mocks.state) => {
          mocks.state = handler;
        },
        getState: () => "OPEN",
        getLastMessageAgeMs: () => mocks.ageMs,
        getReconnectCount: () => 0
      };
    }
  };
});
import { dashboardFeedDuration, runDashboardFeed } from "./dashboard-feed.js";

describe("public dashboard feed", () => {
  it("retains cumulative reconnect counts across supervisor attempts", async () => {
    const registry = new Registry();
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const run = runDashboardFeed({
        signal: controller.signal,
        log: vi.fn(),
        metricsRegistry: registry
      });
      await vi.advanceTimersByTimeAsync(1);
      mocks.reconnect?.();
      controller.abort();
      await run;
    }
    expect(await registry.metrics()).toContain("ws_reconnects_total 2");
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubEnv("MARKET_DATA_ENV", "production");
    mocks.message = undefined;
    mocks.ageMs = 1;
    mocks.useRealManager = false;
    mocks.sockets = [];
    mocks.socketUrls = [];
    mocks.command.mockImplementation(async (args: string[]) => (args[0] === "SET" ? "OK" : 1));
    mocks.connect.mockResolvedValue(undefined);
    mocks.close.mockResolvedValue(undefined);
    mocks.start.mockResolvedValue(undefined);
    mocks.ingest.mockResolvedValue({ event: { kind: "trade" } });
    mocks.drain.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("runs past one hour with no lifetime timer and renews ownership", async () => {
    const controller = new AbortController();
    const log = vi.fn();
    const run = runDashboardFeed({ signal: controller.signal, log });
    await vi.advanceTimersByTimeAsync(3601000);
    expect(mocks.socketConnect).toHaveBeenCalledOnce();
    expect(mocks.socketClose).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ durationMs: null, recording: false, trading: false })
    );
    expect(mocks.command.mock.calls.filter(([args]) => args[0] === "EVAL").length).toBeGreaterThan(
      350
    );
    controller.abort();
    await run;
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("requires a recent message for readiness and clears readiness on shutdown", async () => {
    mocks.ageMs = undefined;
    const controller = new AbortController();
    const onReady = vi.fn();
    const run = runDashboardFeed({ signal: controller.signal, log: vi.fn(), onReady });
    await vi.advanceTimersByTimeAsync(1);
    mocks.state?.({ state: "OPEN" });
    expect(onReady).not.toHaveBeenCalledWith(true);
    mocks.ageMs = 1;
    await vi.advanceTimersByTimeAsync(5000);
    expect(onReady).toHaveBeenLastCalledWith(true);
    mocks.ageMs = 16000;
    await vi.advanceTimersByTimeAsync(5000);
    expect(onReady).toHaveBeenLastCalledWith(false);
    controller.abort();
    await run;
    expect(onReady).toHaveBeenLastCalledWith(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains a bounded explicit preview", async () => {
    const run = runDashboardFeed({
      signal: new AbortController().signal,
      durationMs: 1000,
      log: vi.fn()
    });
    await vi.advanceTimersByTimeAsync(1001);
    await run;
    expect(mocks.socketClose).toHaveBeenCalledOnce();
    expect(() =>
      dashboardFeedDuration({ signal: new AbortController().signal, durationMs: 3600001 })
    ).toThrow();
  });

  it("does not connect a duplicate publisher", async () => {
    mocks.command.mockResolvedValue(null);
    await expect(
      runDashboardFeed({ signal: new AbortController().signal, log: vi.fn() })
    ).rejects.toThrow("already_running");
    expect(mocks.socketConnect).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.command).toHaveBeenCalledOnce();
  });

  it("stops ingestion when ownership is lost", async () => {
    const run = runDashboardFeed({ signal: new AbortController().signal, log: vi.fn() });
    const result = expect(run).rejects.toThrow("lease_lost");
    await vi.advanceTimersByTimeAsync(1);
    mocks.command.mockResolvedValue(0);
    await vi.advanceTimersByTimeAsync(10000);
    await result;
    mocks.message?.({ data: "ignored" });
    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  it("fails closed on a stale socket so the service can retry", async () => {
    const run = runDashboardFeed({ signal: new AbortController().signal, log: vi.fn() });
    const result = expect(run).rejects.toThrow("stale");
    await vi.advanceTimersByTimeAsync(1);
    mocks.state?.({ state: "STALE" });
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("caps the ingestion backlog and closes on failure", async () => {
    const registry = new Registry();
    const run = runDashboardFeed({
      signal: new AbortController().signal,
      log: vi.fn(),
      metricsRegistry: registry
    });
    const result = expect(run).rejects.toThrow("backlog_capacity");
    await vi.advanceTimersByTimeAsync(1);
    for (let index = 0; index < 1001; index++) mocks.message?.({ data: "queued" });
    await result;
    expect(mocks.ingest).toHaveBeenCalledTimes(1000);
    expect(mocks.socketClose).toHaveBeenCalledOnce();
    expect(await registry.metrics()).toContain("ingestor_backpressure_rejections_total 1");
    expect(mocks.drain).toHaveBeenCalledOnce();
  });

  it("fences a dropped depth diff on the real socket-manager path and recovers with a fresh attempt", async () => {
    mocks.useRealManager = true;
    const socket = () => {
      const value = new EventEmitter();
      return Object.assign(value, { close: vi.fn(() => value.emit("close")) });
    };
    const firstSocket = socket();
    const nextSocket = socket();
    mocks.sockets = [firstSocket, nextSocket];
    const accepted: string[] = [];
    const releases: (() => void)[] = [];
    const ingestor = createMarketIngestor({
      buffer: { capacity: 1000, batchSize: 128, flushMs: 1 },
      xadd: async (_stream, _id, fields) => {
        accepted.push(fields.eventId);
        return new Promise<string>((resolve) => {
          releases.push(() => resolve(`${fields.eventId}-0`));
        });
      },
      upsertTrades: vi.fn(),
      upsertKlines: vi.fn()
    });
    mocks.ingest.mockImplementation(ingestor.ingest);
    mocks.drain.mockImplementation(() => ingestor.drain!());
    const registry = new Registry();
    const onReady = vi.fn();
    const log = vi.fn();
    const run = runDashboardFeed({
      signal: new AbortController().signal,
      metricsRegistry: registry,
      onReady,
      log
    });
    const outcome = expect(run).rejects.toThrow("backlog_capacity");
    await vi.advanceTimersByTimeAsync(1);
    firstSocket.emit("open");
    await vi.advanceTimersByTimeAsync(5000);
    expect(onReady).toHaveBeenLastCalledWith(true);
    const diff = (id: number) =>
      JSON.stringify({
        stream: "btcusdt@depth",
        data: {
          e: "depthUpdate",
          E: Date.now(),
          s: "BTCUSDT",
          U: id,
          u: id,
          b: [["100", "1"]],
          a: [["101", "1"]]
        }
      });
    for (let id = 1; id <= 1001; id++) firstSocket.emit("message", diff(id));
    expect(accepted).toHaveLength(1000);
    expect(accepted.at(-1)).toBe("1000");
    expect(firstSocket.close).toHaveBeenCalledOnce();
    expect(onReady).toHaveBeenLastCalledWith(false);
    firstSocket.emit("message", diff(1002));
    firstSocket.emit("open");
    firstSocket.emit("message", diff(1003));
    await vi.advanceTimersByTimeAsync(5000);
    expect(accepted).toHaveLength(1000);
    expect(onReady).toHaveBeenLastCalledWith(false);
    expect(mocks.socketUrls).toHaveLength(1);
    expect(mocks.close).not.toHaveBeenCalled();
    for (const release of releases) release();
    await outcome;
    expect(mocks.drain).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(log).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "public_dashboard_feed_stopped",
        counts: { trade: 0, depth: 1000, kline: 0 }
      })
    );
    expect(await registry.metrics()).toContain("ingestor_backpressure_rejections_total 1");
    expect(vi.getTimerCount()).toBe(0);

    const recovered = createMarketIngestor({
      buffer: { capacity: 1000, batchSize: 128, flushMs: 1 },
      xadd: async (_stream, _id, fields) => {
        accepted.push(fields.eventId);
        return "1002-0";
      },
      upsertTrades: vi.fn(),
      upsertKlines: vi.fn()
    });
    mocks.ingest.mockImplementation(recovered.ingest);
    mocks.drain.mockImplementation(() => recovered.drain!());
    const controller = new AbortController();
    const retry = runDashboardFeed({
      signal: controller.signal,
      metricsRegistry: registry,
      onReady,
      log
    });
    await vi.advanceTimersByTimeAsync(1);
    nextSocket.emit("open");
    nextSocket.emit("message", diff(1002));
    await vi.advanceTimersByTimeAsync(5000);
    expect(accepted.at(-1)).toBe("1002");
    expect(onReady).toHaveBeenLastCalledWith(true);
    expect(mocks.socketUrls).toHaveLength(2);
    expect(mocks.socketUrls.every((url) => url.includes("btcusdt@depth"))).toBe(true);
    expect(await registry.metrics()).toContain("ingestor_backpressure_rejections_total 1");
    controller.abort();
    await retry;
    expect(nextSocket.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for accepted persistence before releasing storage on abort", async () => {
    const controller = new AbortController();
    const run = runDashboardFeed({ signal: controller.signal, log: vi.fn() });
    await vi.advanceTimersByTimeAsync(1);
    let release!: (result: unknown) => void;
    mocks.ingest.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    mocks.message?.({ data: "accepted" });
    controller.abort();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.close).not.toHaveBeenCalled();
    release({ event: { kind: "trade" } });
    await run;
    expect(mocks.drain).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("rejects non-public-production configuration", async () => {
    vi.stubEnv("MARKET_DATA_ENV", "testnet");
    await expect(runDashboardFeed({ signal: new AbortController().signal })).rejects.toThrow(
      "requires_production"
    );
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("cleans up a failed database startup for a fresh service attempt", async () => {
    mocks.start.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      runDashboardFeed({ signal: new AbortController().signal, log: vi.fn() })
    ).rejects.toThrow("database unavailable");
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    const controller = new AbortController();
    const retry = runDashboardFeed({ signal: controller.signal, log: vi.fn() });
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.socketConnect).toHaveBeenCalledOnce();
    controller.abort();
    await retry;
  });

  it("stops on ingestion failure instead of accumulating retries in memory", async () => {
    mocks.ingest.mockRejectedValueOnce(new Error("write failed"));
    const run = runDashboardFeed({ signal: new AbortController().signal, log: vi.fn() });
    const result = expect(run).rejects.toThrow("ingest_failed");
    await vi.advanceTimersByTimeAsync(1);
    mocks.message?.({ data: "trade" });
    await result;
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
