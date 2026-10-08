import { describe, expect, it, vi } from "vitest";

import { runExecutorServiceLoop } from "./executor-service-loop.js";
import type { SignalProcessingResult } from "./signal-execution.js";

function logger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

function submitted(signalId: string): SignalProcessingResult {
  return {
    outcome: "submitted",
    signalId,
    clientOrderId: `mrd_${signalId}`
  };
}

describe("runExecutorServiceLoop", () => {
  it("polls until stopped and sleeps only after idle polls", async () => {
    let iterations = 0;
    const sleepMs = vi.fn(async () => undefined);
    const runtime = {
      claimStaleSignalsOnce: vi.fn(async () => []),
      pollSignalsOnce: vi
        .fn()
        .mockResolvedValueOnce([submitted("sig_1")])
        .mockResolvedValueOnce([])
    };

    const result = await runExecutorServiceLoop({
      runtime,
      logger: logger(),
      shouldContinue: () => iterations++ < 2,
      sleepMs,
      idleDelayMs: 25,
      errorDelayMs: 100,
      staleClaimIntervalMs: 1_000,
      nowMs: () => 1_000
    });

    expect(result).toEqual({
      pollIterations: 2,
      staleClaimIterations: 1
    });
    expect(runtime.pollSignalsOnce).toHaveBeenCalledTimes(2);
    expect(sleepMs).toHaveBeenCalledTimes(1);
    expect(sleepMs).toHaveBeenCalledWith(25);
  });

  it("claims stale messages only when the claim interval is due", async () => {
    let iterations = 0;
    const times = [1_000, 1_000, 1_500, 2_000, 2_000];
    const runtime = {
      claimStaleSignalsOnce: vi
        .fn()
        .mockResolvedValueOnce([submitted("stale_1")])
        .mockResolvedValueOnce([]),
      pollSignalsOnce: vi.fn(async () => [submitted("fresh")])
    };
    const log = logger();

    const result = await runExecutorServiceLoop({
      runtime,
      logger: log,
      shouldContinue: () => iterations++ < 3,
      sleepMs: vi.fn(async () => undefined),
      idleDelayMs: 25,
      errorDelayMs: 100,
      staleClaimIntervalMs: 1_000,
      nowMs: () => times.shift() ?? 2_000
    });

    expect(result.staleClaimIterations).toBe(2);
    expect(runtime.claimStaleSignalsOnce).toHaveBeenCalledTimes(2);
    expect(log.info).toHaveBeenCalledWith(
      { processed: 1 },
      "stale signal messages processed"
    );
  });

  it("backs off and continues when an iteration fails", async () => {
    let iterations = 0;
    const error = new Error("redis unavailable");
    const runtime = {
      claimStaleSignalsOnce: vi.fn(async () => []),
      pollSignalsOnce: vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce([submitted("sig_1")])
    };
    const sleepMs = vi.fn(async () => undefined);
    const log = logger();

    const result = await runExecutorServiceLoop({
      runtime,
      logger: log,
      shouldContinue: () => iterations++ < 2,
      sleepMs,
      idleDelayMs: 25,
      errorDelayMs: 100,
      staleClaimIntervalMs: 1_000,
      nowMs: () => 1_000
    });

    expect(result.pollIterations).toBe(1);
    expect(runtime.pollSignalsOnce).toHaveBeenCalledTimes(2);
    expect(sleepMs).toHaveBeenCalledWith(100);
    expect(log.error).toHaveBeenCalledWith(
      { error },
      "executor service loop iteration failed"
    );
  });

  it("logs lifecycle start and stop with iteration counts", async () => {
    let iterations = 0;
    const log = logger();

    const result = await runExecutorServiceLoop({
      runtime: {
        claimStaleSignalsOnce: vi.fn(async () => []),
        pollSignalsOnce: vi.fn(async () => [])
      },
      logger: log,
      shouldContinue: () => iterations++ < 1,
      sleepMs: vi.fn(async () => undefined),
      idleDelayMs: 25,
      errorDelayMs: 100,
      staleClaimIntervalMs: 1_000,
      nowMs: () => 1_000
    });

    expect(result).toEqual({
      pollIterations: 1,
      staleClaimIterations: 1
    });
    expect(log.info).toHaveBeenCalledWith({}, "executor service loop started");
    expect(log.info).toHaveBeenCalledWith(
      {
        pollIterations: 1,
        staleClaimIterations: 1
      },
      "executor service loop stopped"
    );
  });
});
