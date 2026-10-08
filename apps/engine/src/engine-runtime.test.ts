import { describe, expect, it, vi } from "vitest";

import { createEngineRuntime } from "./engine-runtime.js";

describe("createEngineRuntime", () => {
  it("prepares every market consumer on start", async () => {
    const consumers = [
      {
        ensureReady: vi.fn(async () => undefined),
        pollOnce: vi.fn(async () => 0)
      },
      {
        ensureReady: vi.fn(async () => undefined),
        pollOnce: vi.fn(async () => 0)
      }
    ];
    const runtime = createEngineRuntime({ marketConsumers: consumers });

    await runtime.start();

    expect(consumers[0]?.ensureReady).toHaveBeenCalledTimes(1);
    expect(consumers[1]?.ensureReady).toHaveBeenCalledTimes(1);
    expect(consumers[0]?.pollOnce).not.toHaveBeenCalled();
  });

  it("polls all market consumers and returns the total processed messages", async () => {
    const consumers = [
      {
        ensureReady: vi.fn(async () => undefined),
        pollOnce: vi.fn(async () => 2)
      },
      {
        ensureReady: vi.fn(async () => undefined),
        pollOnce: vi.fn(async () => 3)
      }
    ];
    const runtime = createEngineRuntime({ marketConsumers: consumers });

    await expect(runtime.pollMarketOnce()).resolves.toBe(5);

    expect(consumers[0]?.pollOnce).toHaveBeenCalledTimes(1);
    expect(consumers[1]?.pollOnce).toHaveBeenCalledTimes(1);
  });

  it("propagates consumer failures so the service loop can back off", async () => {
    const error = new Error("redis unavailable");
    const runtime = createEngineRuntime({
      marketConsumers: [
        {
          ensureReady: vi.fn(async () => undefined),
          pollOnce: vi.fn(async () => {
            throw error;
          })
        }
      ]
    });

    await expect(runtime.pollMarketOnce()).rejects.toBe(error);
  });
});
