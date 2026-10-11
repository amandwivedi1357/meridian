import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Registry } from "@meridian/observability";

const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  connect: vi.fn(),
  destroy: vi.fn(),
  close: vi.fn(),
  start: vi.fn(),
  ingest: vi.fn(),
  socketConnect: vi.fn(),
  socketClose: vi.fn(),
  ageMs: 1 as number | undefined,
  message: undefined as undefined | ((message: { data: string }) => void),
  state: undefined as undefined | ((event: { state: string }) => void),
  reconnect: undefined as undefined | (() => void)
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
  createIngestorApp: () => ({ start: mocks.start, ingest: mocks.ingest })
}));
vi.mock("@meridian/binance-client", () => ({
  tradeStream: vi.fn(),
  depthStream: vi.fn(),
  klineStream: vi.fn(),
  createStreamConnectionManager: (options: { onReconnect: () => void }) => {
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
}));
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
    mocks.command.mockImplementation(async (args: string[]) => (args[0] === "SET" ? "OK" : 1));
    mocks.connect.mockResolvedValue(undefined);
    mocks.close.mockResolvedValue(undefined);
    mocks.start.mockResolvedValue(undefined);
    mocks.ingest.mockResolvedValue({ event: { kind: "trade" } });
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
    const run = runDashboardFeed({ signal: new AbortController().signal, log: vi.fn() });
    const result = expect(run).rejects.toThrow("backlog_capacity");
    await vi.advanceTimersByTimeAsync(1);
    for (let index = 0; index < 1001; index++) mocks.message?.({ data: "queued" });
    await result;
    expect(mocks.ingest).not.toHaveBeenCalled();
    expect(mocks.socketClose).toHaveBeenCalledOnce();
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
