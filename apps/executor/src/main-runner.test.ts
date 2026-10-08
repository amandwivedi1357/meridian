import { describe, expect, it, vi } from "vitest";

import { runExecutorMain } from "./main-runner.js";

function logger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

describe("runExecutorMain", () => {
  it("starts runtime before entering the service loop", async () => {
    const events: string[] = [];
    let iterations = 0;
    const runtime = {
      start: vi.fn(async () => {
        events.push("start");
        return {
          reconciliationReport: {
            checked: 0,
            matched: [],
            missingOnExchange: [],
            terminalOnExchange: [],
            queryFailed: []
          }
        };
      }),
      reconcileAfterReconnect: vi.fn(),
      claimStaleSignalsOnce: vi.fn(async () => {
        events.push("claim");
        return [];
      }),
      pollSignalsOnce: vi.fn(async () => {
        events.push("poll");
        return [];
      })
    };

    const result = await runExecutorMain({
      runtime,
      logger: logger(),
      shouldContinue: () => iterations++ < 1,
      sleepMs: vi.fn(async () => undefined),
      idleDelayMs: 25,
      errorDelayMs: 100,
      staleClaimIntervalMs: 1_000,
      nowMs: () => 1_000
    });

    expect(events).toEqual(["start", "claim", "poll"]);
    expect(result).toEqual({
      kind: "executor-stopped",
      pollIterations: 1,
      staleClaimIterations: 1
    });
  });

  it("does not poll signals when runtime startup fails", async () => {
    const error = new Error("startup reconciliation failed");
    const runtime = {
      start: vi.fn(async () => {
        throw error;
      }),
      reconcileAfterReconnect: vi.fn(),
      claimStaleSignalsOnce: vi.fn(),
      pollSignalsOnce: vi.fn()
    };

    await expect(
      runExecutorMain({
        runtime,
        logger: logger(),
        shouldContinue: () => true,
        sleepMs: vi.fn(async () => undefined),
        idleDelayMs: 25,
        errorDelayMs: 100,
        staleClaimIntervalMs: 1_000,
        nowMs: () => 1_000
      })
    ).rejects.toBe(error);

    expect(runtime.claimStaleSignalsOnce).not.toHaveBeenCalled();
    expect(runtime.pollSignalsOnce).not.toHaveBeenCalled();
  });
});
