import { EventEmitter } from "node:events";
import { Registry } from "@meridian/observability";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
import { createJobDispatcher } from "./job-dispatcher.js";

function fixture(queued = false) {
  const query = vi.fn(async (text: string) => {
    if (text.startsWith("SELECT job_id") && queued) {
      queued = false;
      return { rows: [{ job_id: "fixture-id" }] };
    }
    return { rows: [] };
  });
  const connect = vi.fn(async () => ({ query, release: vi.fn() }));
  const child = Object.assign(new EventEmitter(), {
    kill: vi.fn(() => {
      queueMicrotask(() => child.emit("close", null));
      return true;
    })
  });
  mocks.spawn.mockReturnValue(child);
  const registry = new Registry();
  const dispatcher = createJobDispatcher(
    { query, connect } as unknown as Pool,
    "postgres://fixture",
    { metricsRegistry: registry, intervalMs: 100, timeoutMs: 1000 }
  );
  return { dispatcher, query, connect, child, registry };
}
describe("backtest dispatcher health", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    mocks.spawn.mockReset();
  });
  afterEach(() => vi.useRealTimers());
  it("reports idle readiness, dependency failures, recovery and shutdown", async () => {
    const f = fixture();
    expect(f.dispatcher.health()).toMatchObject({ status: "unavailable", activeChildren: 0 });
    f.dispatcher.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.dispatcher.health()).toMatchObject({ status: "ready", activeChildren: 0 });
    expect(mocks.spawn).not.toHaveBeenCalled();
    f.connect.mockRejectedValueOnce(new Error("private-error"));
    await vi.advanceTimersByTimeAsync(100);
    expect(f.dispatcher.health().status).toBe("unavailable");
    await vi.advanceTimersByTimeAsync(100);
    expect(f.dispatcher.health().status).toBe("ready");
    await f.dispatcher.close();
    expect(f.dispatcher.health().status).toBe("stopping");
    const metrics = await f.registry.metrics();
    expect(metrics).toContain('meridian_backtest_dispatcher_ticks_total{outcome="failure"} 1');
    expect(metrics).toContain("meridian_backtest_dispatcher_ready 0");
    expect(metrics).not.toContain("private-error");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("makes a stuck tick unready and recovers when it finishes", async () => {
    const f = fixture();
    f.dispatcher.start();
    await vi.advanceTimersByTimeAsync(1);
    let release!: (value: Awaited<ReturnType<typeof f.connect>>) => void;
    f.connect.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    await vi.advanceTimersByTimeAsync(11000);
    expect(f.dispatcher.health().status).toBe("unavailable");
    release({ query: f.query, release: vi.fn() });
    await vi.advanceTimersByTimeAsync(1);
    expect(f.dispatcher.health().status).toBe("ready");
    await f.dispatcher.close();
  });
  it.each(["exit_zero", "exit_nonzero", "spawn_error", "timeout", "shutdown"] as const)(
    "records process outcome %s, not durable job success",
    async (outcome) => {
      const f = fixture(true);
      f.dispatcher.start();
      await vi.advanceTimersByTimeAsync(1);
      expect(f.dispatcher.health().activeChildren).toBe(1);
      if (outcome === "shutdown") await f.dispatcher.close();
      else if (outcome === "timeout") await vi.advanceTimersByTimeAsync(1000);
      else if (outcome === "spawn_error") f.child.emit("error", new Error("private-error"));
      else f.child.emit("close", outcome === "exit_zero" ? 0 : 1);
      await vi.advanceTimersByTimeAsync(0);
      expect(f.dispatcher.health().activeChildren).toBe(0);
      const metrics = await f.registry.metrics();
      expect(metrics).toContain(`meridian_backtest_process_exits_total{outcome="${outcome}"} 1`);
      expect(metrics).toContain("meridian_backtest_active_children 0");
      expect(metrics).not.toContain("private-error");
      await f.dispatcher.close();
      expect(vi.getTimerCount()).toBe(0);
    }
  );
});
