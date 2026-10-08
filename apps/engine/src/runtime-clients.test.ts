import { describe, expect, it, vi } from "vitest";

import { createEngineRuntimeClients } from "./runtime-clients.js";

describe("createEngineRuntimeClients", () => {
  it("wraps redis command clients behind the stream interface", async () => {
    const postgresPool = {
      query: vi.fn(async () => ({ rows: [{ ok: true }] })),
      end: vi.fn(async () => undefined)
    };
    const redisCommandClient = {
      connect: vi.fn(async () => undefined),
      quit: vi.fn(async () => undefined),
      sendCommand: vi.fn(async (args: readonly (string | Buffer)[]) => {
        if (args[0] === "XACK") return 1;
        return "1700000000000-0";
      })
    };
    const clients = createEngineRuntimeClients(
      {
        postgresUrl: "postgres://user:pass@localhost:5432/meridian",
        redisUrl: "redis://localhost:6379"
      },
      {
        createPostgresPool: vi.fn(() => postgresPool),
        createRedisCommandClient: vi.fn(() => redisCommandClient)
      }
    );

    await clients.redis.connect();
    const queryResult = await clients.postgres.query({
      text: "SELECT $1::text",
      values: ["ok"]
    });
    const streamId = await clients.redis.xAdd("signals", "*", {
      kind: "signal",
      payload: "{}"
    });
    const ackCount = await clients.redis.xAck("signals", "engine", "1-0");
    await clients.close();

    expect(queryResult.rows).toEqual([{ ok: true }]);
    expect(postgresPool.query).toHaveBeenCalledWith("SELECT $1::text", ["ok"]);
    expect(streamId).toBe("1700000000000-0");
    expect(ackCount).toBe(1);
    expect(redisCommandClient.connect).toHaveBeenCalledOnce();
    expect(redisCommandClient.quit).toHaveBeenCalledOnce();
    expect(postgresPool.end).toHaveBeenCalledOnce();
  });

  it("does not quit redis when the client was never connected", async () => {
    const redisCommandClient = {
      connect: vi.fn(async () => undefined),
      quit: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => "1700000000000-0")
    };
    const clients = createEngineRuntimeClients(
      {
        postgresUrl: "postgres://user:pass@localhost:5432/meridian",
        redisUrl: "redis://localhost:6379"
      },
      {
        createPostgresPool: vi.fn(() => ({
          query: vi.fn(async () => ({ rows: [] })),
          end: vi.fn(async () => undefined)
        })),
        createRedisCommandClient: vi.fn(() => redisCommandClient)
      }
    );

    await clients.close();

    expect(redisCommandClient.quit).not.toHaveBeenCalled();
  });
});
