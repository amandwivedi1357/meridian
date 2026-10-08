import { describe, expect, it, vi } from "vitest";

import { runEngineMain } from "./main-runner.js";

function logger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

describe("runEngineMain", () => {
  it("starts runtime before entering the service loop", async () => {
    const events: string[] = [];
    let iterations = 0;
    const runtime = {
      start: vi.fn(async () => {
        events.push("start");
      }),
      pollMarketOnce: vi.fn(async () => {
        events.push("poll");
        return 1;
      })
    };

    const result = await runEngineMain({
      runtime,
      logger: logger(),
      shouldContinue: () => iterations++ < 1,
      sleepMs: vi.fn(async () => undefined),
      idleDelayMs: 25,
      errorDelayMs: 100
    });

    expect(events).toEqual(["start", "poll"]);
    expect(result).toEqual({
      kind: "engine-stopped",
      pollIterations: 1,
      marketMessagesProcessed: 1
    });
  });

  it("does not poll when runtime startup fails", async () => {
    const error = new Error("consumer group unavailable");
    const runtime = {
      start: vi.fn(async () => {
        throw error;
      }),
      pollMarketOnce: vi.fn()
    };

    await expect(
      runEngineMain({
        runtime,
        logger: logger(),
        shouldContinue: () => true,
        sleepMs: vi.fn(async () => undefined),
        idleDelayMs: 25,
        errorDelayMs: 100
      })
    ).rejects.toBe(error);

    expect(runtime.pollMarketOnce).not.toHaveBeenCalled();
  });
});
