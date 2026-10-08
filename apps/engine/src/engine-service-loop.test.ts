import { describe, expect, it, vi } from "vitest";

import { runEngineServiceLoop } from "./engine-service-loop.js";

function logger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

describe("runEngineServiceLoop", () => {
  it("polls until stopped and sleeps only after idle polls", async () => {
    let iterations = 0;
    const sleepMs = vi.fn(async () => undefined);
    const runtime = {
      pollMarketOnce: vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(0)
    };

    const result = await runEngineServiceLoop({
      runtime,
      logger: logger(),
      shouldContinue: () => iterations++ < 2,
      sleepMs,
      idleDelayMs: 25,
      errorDelayMs: 100
    });

    expect(result).toEqual({
      pollIterations: 2,
      marketMessagesProcessed: 2
    });
    expect(runtime.pollMarketOnce).toHaveBeenCalledTimes(2);
    expect(sleepMs).toHaveBeenCalledTimes(1);
    expect(sleepMs).toHaveBeenCalledWith(25);
  });

  it("backs off and continues when polling fails", async () => {
    let iterations = 0;
    const error = new Error("redis unavailable");
    const sleepMs = vi.fn(async () => undefined);
    const log = logger();
    const runtime = {
      pollMarketOnce: vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(1)
    };

    const result = await runEngineServiceLoop({
      runtime,
      logger: log,
      shouldContinue: () => iterations++ < 2,
      sleepMs,
      idleDelayMs: 25,
      errorDelayMs: 100
    });

    expect(result).toEqual({
      pollIterations: 1,
      marketMessagesProcessed: 1
    });
    expect(runtime.pollMarketOnce).toHaveBeenCalledTimes(2);
    expect(sleepMs).toHaveBeenCalledWith(100);
    expect(log.error).toHaveBeenCalledWith(
      { error },
      "engine service loop iteration failed"
    );
  });

  it("logs lifecycle start and stop with counters", async () => {
    let iterations = 0;
    const log = logger();

    const result = await runEngineServiceLoop({
      runtime: {
        pollMarketOnce: vi.fn(async () => 0)
      },
      logger: log,
      shouldContinue: () => iterations++ < 1,
      sleepMs: vi.fn(async () => undefined),
      idleDelayMs: 25,
      errorDelayMs: 100
    });

    expect(result).toEqual({
      pollIterations: 1,
      marketMessagesProcessed: 0
    });
    expect(log.info).toHaveBeenCalledWith({}, "engine service loop started");
    expect(log.info).toHaveBeenCalledWith(
      {
        pollIterations: 1,
        marketMessagesProcessed: 0
      },
      "engine service loop stopped"
    );
  });
});
