import { describe, expect, it, vi } from "vitest";
import {
  ackStreamMessage,
  autoClaimStaleMessages,
  createRedisStreamClient,
  ensureConsumerGroup,
  marketBookStream,
  marketKlineStream,
  marketTradeStream,
  publishStreamMessage,
  readConsumerGroup,
  streams,
  type RedisStreamClient
} from "./index.js";

function createClient(overrides: Partial<RedisStreamClient> = {}): RedisStreamClient {
  return {
    xAdd: vi.fn(async () => "1-0"),
    xGroupCreate: vi.fn(async () => "OK"),
    xReadGroup: vi.fn(async () => null),
    xAck: vi.fn(async () => 1),
    xAutoClaim: vi.fn(async () => ({
      nextStartId: "0-0",
      messages: []
    })),
    ...overrides
  };
}

describe("stream names", () => {
  it("exposes stable stream names", () => {
    expect(streams).toEqual({
      control: "control",
      orderCommands: "orders.commands",
      orderEvents: "orders.events",
      signals: "signals"
    });
    expect(marketTradeStream("BTCUSDT")).toBe("market.trade.BTCUSDT");
    expect(marketKlineStream("BTCUSDT", "1m")).toBe("market.kline.BTCUSDT.1m");
    expect(marketBookStream("BTCUSDT")).toBe("market.book.BTCUSDT");
  });
});

describe("createRedisStreamClient", () => {
  it("translates XADD commands and returns the stream id", async () => {
    const commandClient = {
      sendCommand: vi.fn(async () => "1-0")
    };
    const client = createRedisStreamClient(commandClient);
    const fields = {
      kind: "trade",
      payload: Buffer.from("hello")
    };

    const id = await client.xAdd("market.trade.BTCUSDT", "*", fields);

    expect(id).toBe("1-0");
    expect(commandClient.sendCommand).toHaveBeenCalledWith([
      "XADD",
      "market.trade.BTCUSDT",
      "*",
      "kind",
      "trade",
      "payload",
      Buffer.from("hello")
    ]);
  });

  it("translates XGROUP CREATE commands with MKSTREAM", async () => {
    const commandClient = {
      sendCommand: vi.fn(async () => "OK")
    };
    const client = createRedisStreamClient(commandClient);

    await client.xGroupCreate("signals", "engine", "$", { mkStream: true });

    expect(commandClient.sendCommand).toHaveBeenCalledWith([
      "XGROUP",
      "CREATE",
      "signals",
      "engine",
      "$",
      "MKSTREAM"
    ]);
  });

  it("translates XREADGROUP commands and parses stream messages", async () => {
    const commandClient = {
      sendCommand: vi.fn(async () => [
        ["signals", [["1-0", ["kind", "signal", "payload", Buffer.from("encoded")]]]]
      ])
    };
    const client = createRedisStreamClient(commandClient);

    const result = await client.xReadGroup("engine", "engine-1", [{ key: "signals", id: ">" }], {
      count: 10,
      blockMs: 1000
    });

    expect(commandClient.sendCommand).toHaveBeenCalledWith([
      "XREADGROUP",
      "GROUP",
      "engine",
      "engine-1",
      "COUNT",
      "10",
      "BLOCK",
      "1000",
      "STREAMS",
      "signals",
      ">"
    ]);
    expect(result).toEqual([
      {
        stream: "signals",
        messages: [
          {
            id: "1-0",
            fields: {
              kind: "signal",
              payload: Buffer.from("encoded")
            }
          }
        ]
      }
    ]);
  });

  it("passes through null XREADGROUP replies", async () => {
    const commandClient = {
      sendCommand: vi.fn(async () => null)
    };
    const client = createRedisStreamClient(commandClient);

    await expect(
      client.xReadGroup("engine", "engine-1", [{ key: "signals", id: ">" }])
    ).resolves.toBeNull();
  });

  it("parses object-shaped XREADGROUP replies from node-redis", async () => {
    const commandClient = {
      sendCommand: vi.fn(async () => ({
        signals: [["1-0", ["payload", "encoded"]]]
      }))
    };
    const client = createRedisStreamClient(commandClient);

    await expect(
      client.xReadGroup("engine", "engine-1", [{ key: "signals", id: ">" }])
    ).resolves.toEqual([
      {
        stream: "signals",
        messages: [
          {
            id: "1-0",
            fields: {
              payload: "encoded"
            }
          }
        ]
      }
    ]);
  });

  it("translates XACK commands and parses the ack count", async () => {
    const commandClient = {
      sendCommand: vi.fn(async () => 1)
    };
    const client = createRedisStreamClient(commandClient);

    const acked = await client.xAck("signals", "engine", "1-0");

    expect(acked).toBe(1);
    expect(commandClient.sendCommand).toHaveBeenCalledWith(["XACK", "signals", "engine", "1-0"]);
  });

  it("translates XAUTOCLAIM commands and parses claimed messages", async () => {
    const commandClient = {
      sendCommand: vi.fn(async () => ["2-0", [["1-0", ["payload", "encoded"]]], []])
    };
    const client = createRedisStreamClient(commandClient);

    const result = await client.xAutoClaim("signals", "engine", "engine-2", 30_000, "0-0", {
      count: 100
    });

    expect(commandClient.sendCommand).toHaveBeenCalledWith([
      "XAUTOCLAIM",
      "signals",
      "engine",
      "engine-2",
      "30000",
      "0-0",
      "COUNT",
      "100"
    ]);
    expect(result).toEqual({
      nextStartId: "2-0",
      messages: [
        {
          id: "1-0",
          fields: {
            payload: "encoded"
          }
        }
      ]
    });
  });
});

describe("Redis stream helpers", () => {
  it("publishes stream messages with an auto-generated id", async () => {
    const client = createClient();
    const fields = {
      kind: "trade",
      payload: Buffer.from("hello")
    };

    const id = await publishStreamMessage(client, "market.trade.BTCUSDT", fields);

    expect(id).toBe("1-0");
    expect(client.xAdd).toHaveBeenCalledWith("market.trade.BTCUSDT", "*", fields);
  });

  it("creates consumer groups with MKSTREAM", async () => {
    const client = createClient();

    await ensureConsumerGroup(client, "signals", "engine", "$");

    expect(client.xGroupCreate).toHaveBeenCalledWith("signals", "engine", "$", {
      mkStream: true
    });
  });

  it("ignores existing consumer group errors", async () => {
    const client = createClient({
      xGroupCreate: vi.fn(async () => {
        throw new Error("BUSYGROUP Consumer Group name already exists");
      })
    });

    await expect(ensureConsumerGroup(client, "signals", "engine")).resolves.toBeUndefined();
  });

  it("throws unexpected consumer group creation errors", async () => {
    const client = createClient({
      xGroupCreate: vi.fn(async () => {
        throw new Error("NOAUTH Authentication required");
      })
    });

    await expect(ensureConsumerGroup(client, "signals", "engine")).rejects.toThrow("NOAUTH");
  });

  it("reads new messages for a consumer group", async () => {
    const results = [
      {
        stream: "signals",
        messages: [
          {
            id: "1-0",
            fields: {
              payload: "encoded"
            }
          }
        ]
      }
    ];
    const client = createClient({
      xReadGroup: vi.fn(async () => results)
    });

    const read = await readConsumerGroup(client, "engine", "engine-1", "signals", {
      count: 10,
      blockMs: 1000
    });

    expect(read).toBe(results);
    expect(client.xReadGroup).toHaveBeenCalledWith(
      "engine",
      "engine-1",
      [{ key: "signals", id: ">" }],
      { count: 10, blockMs: 1000 }
    );
  });

  it("acks processed stream messages", async () => {
    const client = createClient();

    const acked = await ackStreamMessage(client, "signals", "engine", "1-0");

    expect(acked).toBe(1);
    expect(client.xAck).toHaveBeenCalledWith("signals", "engine", "1-0");
  });

  it("claims stale pending messages", async () => {
    const claimed = {
      nextStartId: "2-0",
      messages: [
        {
          id: "1-0",
          fields: {
            payload: "encoded"
          }
        }
      ]
    };
    const client = createClient({
      xAutoClaim: vi.fn(async () => claimed)
    });

    const result = await autoClaimStaleMessages(
      client,
      "signals",
      "engine",
      "engine-2",
      30_000,
      "0-0",
      { count: 100 }
    );

    expect(result).toBe(claimed);
    expect(client.xAutoClaim).toHaveBeenCalledWith("signals", "engine", "engine-2", 30_000, "0-0", {
      count: 100
    });
  });
});
