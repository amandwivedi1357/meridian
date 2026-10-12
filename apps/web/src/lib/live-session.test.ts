import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api-client.js";
import { startLiveSession, type LiveDependencies } from "./live-session.js";
import { useTerminalStore } from "./terminal-store.js";
import { account, depth, snapshot } from "./terminal-fixtures.js";

class FakeSource {
  listeners = new Map<string, (event: MessageEvent) => void>();
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, listener);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown, id = "next") {
    this.listeners.get(type)?.({ data: JSON.stringify(data), lastEventId: id } as MessageEvent);
  }
}
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  useTerminalStore.getState().setSession({ role: "viewer", actor: "test" }, "ready");
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
});
function setup() {
  const sources: FakeSource[] = [];
  const deps: LiveDependencies = {
    snapshot: vi.fn(async () => snapshot()),
    account: vi.fn(async () => account()),
    session: vi.fn(async () => ({ principal: { role: "viewer" as const, actor: "test" } })),
    source: (url) => {
      const s = new FakeSource(url);
      sources.push(s);
      return s;
    },
    frame: (callback) => {
      const timer = setTimeout(callback, 16);
      return () => clearTimeout(timer);
    }
  };
  stop = startLiveSession("15m", deps);
  return { deps, sources };
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
describe("live session transport", () => {
  it("receives health and heartbeat without REST polling or market cursor changes", async () => {
    const { deps, sources } = setup();
    await settle();
    const source = sources.find((s) => s.url.includes("account"))!;
    source.emit("ready", {});
    source.emit(
      "health",
      { checkedAt: Date.now(), redis: "available", database: "available", streams: [] },
      "ignored-health-id"
    );
    expect(useTerminalStore.getState().health?.redis).toBe("available");
    await vi.advanceTimersByTimeAsync(1000);
    source.emit("heartbeat", { checkedAt: Date.now() });
    expect(useTerminalStore.getState().transport.account.lastReceivedAt).toBe(Date.now());
    expect(deps.account).toHaveBeenCalledOnce();
    source.emit("health", { checkedAt: -1 });
    expect(useTerminalStore.getState().health).toBeNull();
    expect(source.closed).toBe(false);
  });
  it("counts recovery attempts, ignores late health and clears telemetry on logout", async () => {
    const { sources } = setup();
    await settle();
    const source = sources[0]!;
    source.emit("resync", {});
    expect(useTerminalStore.getState().transport.market.reconnects).toBe(1);
    source.emit("heartbeat", {});
    expect(useTerminalStore.getState().transport.market.lastReceivedAt).toBeNull();
    useTerminalStore.getState().setSession(null, "required");
    expect(useTerminalStore.getState().health).toBeNull();
    expect(useTerminalStore.getState().transport.market.reconnects).toBe(0);
  });
  it("does not roll REST account state backward during retained SSE replay", async () => {
    const { sources } = setup();
    await settle();
    const current = useTerminalStore.getState().account!;
    const source = sources.find((s) => s.url.includes("account"))!;
    source.emit("account", {
      events: [
        {
          ...account(current.checkedAt - 10000),
          riskControl: {
            scope: "global",
            engaged: false,
            reason: "older snapshot",
            updatedAtMs: current.checkedAt - 10000
          }
        }
      ]
    });
    await vi.advanceTimersByTimeAsync(16);
    expect(useTerminalStore.getState().account).toEqual(current);
  });
  it("bootstraps once and does not poll healthy channels", async () => {
    const { deps, sources } = setup();
    await settle();
    expect(sources[0]?.url).toContain("cursor=bootstrap");
    for (const source of sources)
      source.emit("ready", {}, source.url.includes("market") ? "bootstrap" : "0-0");
    for (let index = 0; index < 4; index++) {
      await vi.advanceTimersByTimeAsync(15000);
      for (const source of sources) source.emit("heartbeat", { checkedAt: Date.now() });
    }
    expect(deps.snapshot).toHaveBeenCalledTimes(1);
    expect(deps.account).toHaveBeenCalledTimes(1);
    expect(useTerminalStore.getState().accountConnection).toBe("live");
  });
  it("recovers a silent half-open channel without waiting for an error event", async () => {
    const { deps, sources } = setup();
    await settle();
    const market = sources[0]!;
    const accountSource = sources[1]!;
    market.emit("ready", {}, "retained-cursor");
    accountSource.emit("ready", {}, "account-cursor");
    for (let index = 0; index < 3; index++) {
      await vi.advanceTimersByTimeAsync(15000);
      accountSource.emit("heartbeat", {});
    }
    expect(market.closed).toBe(true);
    expect(accountSource.closed).toBe(false);
    expect(useTerminalStore.getState().marketConnection).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(1000);
    expect(sources.at(-1)?.url).toContain("cursor=retained-cursor");
    expect(deps.snapshot).toHaveBeenCalledOnce();
    stop!();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("times out a connection that never receives ready or heartbeat", async () => {
    const { sources } = setup();
    await settle();
    await vi.advanceTimersByTimeAsync(45000);
    expect(sources.every((source) => source.closed)).toBe(true);
    expect(useTerminalStore.getState().accountConnection).toBe("reconnecting");
  });
  it("batches updates and resumes only the applied cursor", async () => {
    const { sources } = setup();
    await settle();
    const market = sources.find((s) => s.url.includes("market"))!;
    market.emit("market", { events: [depth()] }, "applied");
    await vi.advanceTimersByTimeAsync(16);
    expect(useTerminalStore.getState().market.book?.lastUpdateId).toBe(11);
    market.emit("market", { events: [depth(12, 12)] }, "unapplied");
    market.onerror?.(new Event("error"));
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sources.at(-1)?.url).toContain("cursor=applied");
    expect(sources.at(-1)?.url).not.toContain("unapplied");
  });
  it("gap and server resync clear stale data and obtain fresh bootstrap", async () => {
    const { deps, sources } = setup();
    await settle();
    sources[0]!.emit("market", { events: [depth(20, 20)] });
    await vi.advanceTimersByTimeAsync(16);
    expect(useTerminalStore.getState().market.book).toBeNull();
    expect(sources[0]!.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(deps.snapshot).toHaveBeenCalledTimes(2);
    sources.at(-1)!.emit("resync", { reason: "trimmed" });
    expect(useTerminalStore.getState().market.book).toBeNull();
  });
  it("session expiry closes both streams and clears private account state", async () => {
    const { deps, sources } = setup();
    await settle();
    deps.session = vi.fn(async () => {
      throw new ApiError(401);
    });
    sources[0]!.onerror?.(new Event("error"));
    await settle();
    expect(useTerminalStore.getState().session).toBe("required");
    expect(useTerminalStore.getState().account).toBeNull();
    expect(sources.every((s) => s.closed)).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(sources).toHaveLength(2);
  });
  it("unmount aborts bootstrap and ignores late results", async () => {
    const { deps } = setup();
    stop!();
    await settle();
    expect(useTerminalStore.getState().market.book).toBeNull();
    expect(vi.mocked(deps.snapshot).mock.calls[0]![2].aborted).toBe(true);
  });
  it("invalid frames are bounded and trigger recovery", async () => {
    const { sources } = setup();
    await settle();
    sources[0]!.emit("market", { events: Array.from({ length: 1001 }, () => depth()) });
    expect(sources[0]!.closed).toBe(true);
    expect(useTerminalStore.getState().market.book).toBeNull();
  });
});
