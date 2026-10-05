import { describe, expect, it, vi } from "vitest";
import { enqueueBacktestSweep, runBacktestJobInWorker, type WorkerLike } from "./parallel-backtest.js";

function fakeWorker(emit: (listeners: Record<string, (...args: unknown[]) => void>) => void): WorkerLike {
  const listeners: Record<string, (...args: unknown[]) => void> = {};
  queueMicrotask(() => emit(listeners));
  return {
    once(event, listener) {
      listeners[event] = listener;
    }
  };
}

describe("parallel backtest worker foundation", () => {
  it("resolves worker-thread output", async () => {
    await expect(
      runBacktestJobInWorker(
        { id: "job-1", args: ["--strategy", "ema"] },
        {
          workerScript: "worker.js",
          createWorker: () => fakeWorker((listeners) => listeners.message?.({ totalReturnPct: "1" }))
        }
      )
    ).resolves.toEqual({
      id: "job-1",
      ok: true,
      output: { totalReturnPct: "1" }
    });
  });

  it("captures worker errors and non-zero exits", async () => {
    await expect(
      runBacktestJobInWorker(
        { id: "job-2", args: [] },
        {
          workerScript: "worker.js",
          createWorker: () => fakeWorker((listeners) => listeners.error?.(new Error("boom")))
        }
      )
    ).resolves.toEqual({ id: "job-2", ok: false, error: "boom" });

    await expect(
      runBacktestJobInWorker(
        { id: "job-3", args: [] },
        {
          workerScript: "worker.js",
          createWorker: () => fakeWorker((listeners) => listeners.exit?.(1))
        }
      )
    ).resolves.toEqual({ id: "job-3", ok: false, error: "Worker exited with code 1" });
  });

  it("enqueues sweep jobs through a BullMQ-shaped queue", async () => {
    const add = vi
      .fn()
      .mockResolvedValueOnce({ id: "queued-1" })
      .mockResolvedValueOnce({});

    await expect(
      enqueueBacktestSweep(
        { add },
        [
          { id: "job-1", args: ["a"] },
          { id: "job-2", args: ["b"] }
        ]
      )
    ).resolves.toEqual(["queued-1", "job-2"]);

    expect(add.mock.calls.map((call) => call[0])).toEqual(["backtest", "backtest"]);
  });
});
