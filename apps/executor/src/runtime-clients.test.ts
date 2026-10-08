import { describe, expect, it, vi } from "vitest";

import { createExecutorRuntimeClients } from "./runtime-clients.js";

describe("createExecutorRuntimeClients", () => {
  it("wraps postgres and redis clients behind executor runtime interfaces", async () => {
    const postgresPool = {
      query: vi.fn(async () => ({
        rowCount: 1,
        rows: [{ ok: true }]
      })),
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

    const clients = createExecutorRuntimeClients(
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
    const queryResult = await clients.postgres.execute({
      text: "SELECT $1::text",
      values: ["ok"]
    });
    const streamId = await clients.redis.xAdd("signals", "*", {
      kind: "signal",
      payload: "{}"
    });
    const ackCount = await clients.redis.xAck("signals", "executor", "1-0");
    await clients.close();

    expect(queryResult).toEqual({
      rowCount: 1,
      rows: [{ ok: true }]
    });
    expect(streamId).toBe("1700000000000-0");
    expect(ackCount).toBe(1);
    expect(postgresPool.query).toHaveBeenCalledWith("SELECT $1::text", ["ok"]);
    expect(redisCommandClient.connect).toHaveBeenCalledOnce();
    expect(redisCommandClient.sendCommand).toHaveBeenCalledWith([
      "XADD",
      "signals",
      "*",
      "kind",
      "signal",
      "payload",
      "{}"
    ]);
    expect(redisCommandClient.sendCommand).toHaveBeenCalledWith([
      "XACK",
      "signals",
      "executor",
      "1-0"
    ]);
    expect(redisCommandClient.quit).toHaveBeenCalledOnce();
    expect(postgresPool.end).toHaveBeenCalledOnce();
  });

  it("does not quit redis when the client was never connected", async () => {
    const redisCommandClient = {
      connect: vi.fn(async () => undefined),
      quit: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => "1700000000000-0")
    };
    const clients = createExecutorRuntimeClients(
      {
        postgresUrl: "postgres://user:pass@localhost:5432/meridian",
        redisUrl: "redis://localhost:6379"
      },
      {
        createPostgresPool: vi.fn(() => ({
          query: vi.fn(async () => ({ rowCount: 0, rows: [] })),
          end: vi.fn(async () => undefined)
        })),
        createRedisCommandClient: vi.fn(() => redisCommandClient)
      }
    );

    await clients.close();

    expect(redisCommandClient.quit).not.toHaveBeenCalled();
  });

  it("uses rows length as a rowCount fallback for database adapters that omit it", async () => {
    const clients = createExecutorRuntimeClients(
      {
        postgresUrl: "postgres://user:pass@localhost:5432/meridian",
        redisUrl: "redis://localhost:6379"
      },
      {
        createPostgresPool: vi.fn(() => ({
          query: vi.fn(async () => ({
            rows: [{ one: 1 }, { two: 2 }]
          })),
          end: vi.fn(async () => undefined)
        })),
        createRedisCommandClient: vi.fn(() => ({
          connect: vi.fn(async () => undefined),
          quit: vi.fn(async () => undefined),
          sendCommand: vi.fn(async () => "1700000000000-0")
        }))
      }
    );

    await expect(clients.postgres.execute({ text: "SELECT 1", values: [] })).resolves.toEqual({
      rowCount: 2,
      rows: [{ one: 1 }, { two: 2 }]
    });
  });
});
