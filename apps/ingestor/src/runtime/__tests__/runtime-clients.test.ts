import { describe, expect, it, vi } from "vitest";
import { createRuntimeClients } from "../runtime-clients.js";

describe("createRuntimeClients", () => {
  it("wraps postgres and redis clients behind ingestor runtime interfaces", async () => {
    const postgresPool = {
      query: vi.fn(async () => ({ rows: [{ ok: true }] })),
      end: vi.fn(async () => undefined)
    };
    const redisCommandClient = {
      connect: vi.fn(async () => undefined),
      quit: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => "1700000000000-0")
    };

    const clients = createRuntimeClients(
      {
        postgresUrl: "postgres://user:pass@localhost:5432/meridian",
        redisUrl: "redis://localhost:6379",
        redisStreamMaxLen: 100000
      },
      {
        createPostgresPool: vi.fn(() => postgresPool),
        createRedisCommandClient: vi.fn(() => redisCommandClient)
      }
    );

    await clients.redis.connect();
    const queryResult = await clients.postgres.query("SELECT $1::text", ["ok"]);
    const streamId = await clients.redis.xAdd("market.trade.BTCUSDT", "*", {
      schemaVersion: "1",
      kind: "trade",
      symbol: "BTCUSDT",
      eventId: "trade:BTCUSDT:123",
      occurredAtMs: "1700000000000",
      payload: Buffer.from("encoded")
    });
    await clients.close();

    expect(queryResult.rows).toEqual([{ ok: true }]);
    expect(postgresPool.query).toHaveBeenCalledWith("SELECT $1::text", ["ok"]);
    expect(streamId).toBe("1700000000000-0");
    expect(redisCommandClient.connect).toHaveBeenCalledOnce();
    expect(redisCommandClient.sendCommand).toHaveBeenCalledWith([
      "XADD",
      "market.trade.BTCUSDT",
      "MAXLEN",
      "~",
      "100000",
      "*",
      "schemaVersion",
      "1",
      "kind",
      "trade",
      "symbol",
      "BTCUSDT",
      "eventId",
      "trade:BTCUSDT:123",
      "occurredAtMs",
      "1700000000000",
      "payload",
      Buffer.from("encoded")
    ]);
    expect(redisCommandClient.quit).toHaveBeenCalledOnce();
    expect(postgresPool.end).toHaveBeenCalledOnce();
  });

  it("omits MAXLEN when Redis stream retention is not configured", async () => {
    const redisCommandClient = {
      connect: vi.fn(async () => undefined),
      quit: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => "1700000000000-0")
    };
    const clients = createRuntimeClients(
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

    await clients.redis.xAdd("market.trade.BTCUSDT", "*", {
      schemaVersion: "1",
      kind: "trade",
      symbol: "BTCUSDT",
      eventId: "trade:BTCUSDT:123",
      occurredAtMs: "1700000000000",
      payload: Buffer.from("encoded")
    });

    expect(redisCommandClient.sendCommand).toHaveBeenCalledWith([
      "XADD",
      "market.trade.BTCUSDT",
      "*",
      "schemaVersion",
      "1",
      "kind",
      "trade",
      "symbol",
      "BTCUSDT",
      "eventId",
      "trade:BTCUSDT:123",
      "occurredAtMs",
      "1700000000000",
      "payload",
      Buffer.from("encoded")
    ]);
  });

  it("does not quit redis when the client was never connected", async () => {
    const redisCommandClient = {
      connect: vi.fn(async () => undefined),
      quit: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => "1700000000000-0")
    };
    const clients = createRuntimeClients(
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

  it("fails fast when redis does not return a stream entry id", async () => {
    const clients = createRuntimeClients(
      {
        postgresUrl: "postgres://user:pass@localhost:5432/meridian",
        redisUrl: "redis://localhost:6379"
      },
      {
        createPostgresPool: vi.fn(() => ({
          query: vi.fn(async () => ({ rows: [] })),
          end: vi.fn(async () => undefined)
        })),
        createRedisCommandClient: vi.fn(() => ({
          connect: vi.fn(async () => undefined),
          quit: vi.fn(async () => undefined),
          sendCommand: vi.fn(async () => null)
        }))
      }
    );

    await expect(
      clients.redis.xAdd("market.trade.BTCUSDT", "*", {
        schemaVersion: "1",
        kind: "trade",
        symbol: "BTCUSDT",
        eventId: "trade:BTCUSDT:123",
        occurredAtMs: "1700000000000",
        payload: Buffer.from("encoded")
      })
    ).rejects.toThrow("Redis XADD did not return a stream entry id");
  });
});
