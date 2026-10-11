import { afterEach, describe, expect, it, vi } from "vitest";
import { createShutdownGuard, shutdownTimeout } from "./shutdown.js";
const guards: ReturnType<typeof createShutdownGuard>[] = [];
afterEach(() => {
  guards.splice(0).forEach((g) => g.finish());
  vi.useRealTimers();
});
describe("bounded shutdown", () => {
  it("keeps the deadline referenced until cleanup completes", () => {
    const timers = vi.spyOn(globalThis, "setTimeout");
    const guard = createShutdownGuard({ onStop() {}, forceExit() {}, timeoutMs: 100 });
    guards.push(guard);
    guard.request();
    const timer = timers.mock.results.at(-1)?.value as NodeJS.Timeout;
    expect(timer.hasRef()).toBe(true);
    guard.finish();
    timers.mockRestore();
  });
  it("latches once and keeps a deadline through cleanup", () => {
    vi.useFakeTimers();
    const onStop = vi.fn(),
      forceExit = vi.fn();
    const guard = createShutdownGuard({ onStop, forceExit, timeoutMs: 100 });
    guards.push(guard);
    guard.request();
    guard.request();
    expect(onStop).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(99);
    expect(forceExit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(forceExit).toHaveBeenCalledWith(1);
  });
  it("successful drain cancels deadline and unregisters signals", () => {
    vi.useFakeTimers();
    const initial = process.listenerCount("SIGTERM");
    const forceExit = vi.fn(),
      onStop = vi.fn();
    const guard = createShutdownGuard({ onStop, forceExit, timeoutMs: 100 });
    guards.push(guard);
    expect(process.listenerCount("SIGTERM")).toBe(initial + 1);
    guard.request();
    guard.finish();
    guard.finish();
    guard.request();
    vi.advanceTimersByTime(1000);
    expect(forceExit).not.toHaveBeenCalled();
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(process.listenerCount("SIGTERM")).toBe(initial);
  });
  it("validates deadlines and fails closed if stop itself throws", () => {
    expect(shutdownTimeout({})).toBe(15000);
    for (const value of ["0", "NaN", "100.1", "120001", "1e3"])
      expect(() => shutdownTimeout({ SHUTDOWN_TIMEOUT_MS: value })).toThrow();
    const forceExit = vi.fn();
    const guard = createShutdownGuard({
      forceExit,
      onStop() {
        throw new Error("stop failed");
      }
    });
    guards.push(guard);
    guard.request();
    expect(forceExit).toHaveBeenCalledWith(1);
  });
});
