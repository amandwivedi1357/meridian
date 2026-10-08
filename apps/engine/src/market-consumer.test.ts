import { Decimal, type Signal } from "@meridian/core";
import type { RedisStreamClient } from "@meridian/bus";
import { encodeMarketEvent } from "@meridian/proto";
import { describe, expect, it, vi } from "vitest";

import { createMarketConsumer, type MarketConsumerLogger } from "./market-consumer.js";
import type { LiveMarketEvent } from "./live-strategy-runner.js";

function logger(): MarketConsumerLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

function bus(overrides: Partial<RedisStreamClient> = {}): RedisStreamClient {
  return {
    xAdd: vi.fn(),
    xGroupCreate: vi.fn(async () => "OK"),
    xReadGroup: vi.fn(async () => null),
    xAck: vi.fn(async () => 1),
    xAutoClaim: vi.fn(async () => ({ nextStartId: "0-0", messages: [] })),
    ...overrides
  };
}

function candlePayload() {
  return {
    candle: {
      symbol: "BTCUSDT",
      interval: "1m",
      openTimeMs: 1_000,
      closeTimeMs: 1_999,
      open: "100",
      high: "101",
      low: "99",
      close: "100.5",
      volume: "10",
      closed: true
    }
  };
}

function tradePayload() {
  return {
    trade: {
      symbol: "BTCUSDT",
      tradeId: "12345",
      price: "100.5",
      quantity: "0.25",
      eventTimeMs: 2_000,
      isBuyerMaker: false
    }
  };
}

function bookPayload() {
  return {
    book: {
      symbol: "BTCUSDT",
      bids: [
        {
          price: "100.4",
          quantity: "1.5"
        }
      ],
      asks: [
        {
          price: "100.6",
          quantity: "2.5"
        }
      ],
      eventTimeMs: 2_100
    }
  };
}

function signal(): Signal {
  return {
    signalId: "sig_1",
    strategyId: "ema",
    createdAtMs: 2_000,
    validUntilMs: 7_000,
    intent: {
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: new Decimal("0.0002"),
      limitPrice: new Decimal("100.5"),
      reason: "EMA bullish crossover"
    }
  };
}

describe("createMarketConsumer", () => {
  it("creates the market stream consumer group from the beginning", async () => {
    const redis = bus();
    const consumer = createMarketConsumer({
      bus: redis,
      stream: "market.kline.BTCUSDT.1m",
      group: "engine",
      consumer: "engine-1",
      runner: { handleMarketEvent: vi.fn() },
      logger: logger()
    });

    await consumer.ensureReady();

    expect(redis.xGroupCreate).toHaveBeenCalledWith("market.kline.BTCUSDT.1m", "engine", "0", {
      mkStream: true
    });
  });

  it("parses candle messages, runs the strategy runner, and acknowledges success", async () => {
    const xReadGroup = vi.fn(async () => [
      {
        stream: "market.kline.BTCUSDT.1m",
        messages: [
          {
            id: "1-0",
            fields: {
              kind: "kline",
              payload: JSON.stringify(candlePayload())
            }
          }
        ]
      }
    ]);
    const redis = bus({ xReadGroup });
    const log = logger();
    const handledEvents: LiveMarketEvent[] = [];
    const runner = {
      handleMarketEvent: vi.fn(async (event: LiveMarketEvent) => {
        handledEvents.push(event);
        return [signal()];
      })
    };
    const consumer = createMarketConsumer({
      bus: redis,
      stream: "market.kline.BTCUSDT.1m",
      group: "engine",
      consumer: "engine-1",
      runner,
      logger: log,
      readCount: 3,
      blockMs: 25
    });

    const processed = await consumer.pollOnce();

    expect(processed).toBe(1);
    expect(xReadGroup).toHaveBeenCalledWith(
      "engine",
      "engine-1",
      [{ key: "market.kline.BTCUSDT.1m", id: ">" }],
      { count: 3, blockMs: 25 }
    );
    expect(runner.handleMarketEvent).toHaveBeenCalledWith({
      kind: "candle",
      candle: expect.objectContaining({
        symbol: "BTCUSDT",
        interval: "1m",
        openTimeMs: 1_000,
        closeTimeMs: 1_999,
        closed: true
      })
    });
    const event = handledEvents[0];
    if (event?.kind !== "candle") throw new Error("Expected candle event");
    expect(event.candle.close.toFixed()).toBe("100.5");
    expect(redis.xAck).toHaveBeenCalledWith("market.kline.BTCUSDT.1m", "engine", "1-0");
    expect(log.info).toHaveBeenCalledWith(
      {
        stream: "market.kline.BTCUSDT.1m",
        messageId: "1-0",
        signals: 1
      },
      "market message produced signals"
    );
  });

  it("parses protobuf market messages by default", async () => {
    const handledEvents: LiveMarketEvent[] = [];
    const redis = bus({
      xReadGroup: vi.fn(async () => [
        {
          stream: "market.trade.BTCUSDT",
          messages: [
            {
              id: "1-1",
              fields: {
                kind: "trade",
                payload: Buffer.from(
                  encodeMarketEvent({
                    kind: "trade",
                    symbol: "BTCUSDT",
                    eventId: "12345",
                    occurredAtMs: 2_000,
                    trade: {
                      symbol: "BTCUSDT",
                      tradeId: "12345",
                      price: new Decimal("100.5"),
                      quantity: new Decimal("0.25"),
                      eventTimeMs: 2_000,
                      isBuyerMaker: false
                    }
                  })
                )
              }
            }
          ]
        }
      ])
    });
    const consumer = createMarketConsumer({
      bus: redis,
      stream: "market.trade.BTCUSDT",
      group: "engine",
      consumer: "engine-1",
      runner: {
        handleMarketEvent: vi.fn(async (event: LiveMarketEvent) => {
          handledEvents.push(event);
          return [];
        })
      },
      logger: logger()
    });

    const processed = await consumer.pollOnce();

    expect(processed).toBe(1);
    const event = handledEvents[0];
    if (event?.kind !== "trade") throw new Error("Expected trade event");
    expect(event.trade.price.toString()).toBe("100.5");
    expect(redis.xAck).toHaveBeenCalledWith("market.trade.BTCUSDT", "engine", "1-1");
  });

  it("acknowledges invalid market payloads because retry cannot repair them", async () => {
    const redis = bus({
      xReadGroup: vi.fn(async () => [
        {
          stream: "market.kline.BTCUSDT.1m",
          messages: [
            {
              id: "2-0",
              fields: {
                kind: "kline",
                payload: JSON.stringify({ candle: { symbol: "BTCUSDT" } })
              }
            }
          ]
        }
      ])
    });
    const log = logger();
    const runner = { handleMarketEvent: vi.fn() };
    const consumer = createMarketConsumer({
      bus: redis,
      stream: "market.kline.BTCUSDT.1m",
      group: "engine",
      consumer: "engine-1",
      runner,
      logger: log
    });

    const processed = await consumer.pollOnce();

    expect(processed).toBe(0);
    expect(runner.handleMarketEvent).not.toHaveBeenCalled();
    expect(redis.xAck).toHaveBeenCalledWith("market.kline.BTCUSDT.1m", "engine", "2-0");
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: "market.kline.BTCUSDT.1m",
        messageId: "2-0"
      }),
      "invalid market message dropped"
    );
  });

  it("parses trade messages and routes them to the strategy runner", async () => {
    const handledEvents: LiveMarketEvent[] = [];
    const redis = bus({
      xReadGroup: vi.fn(async () => [
        {
          stream: "market.trade.BTCUSDT",
          messages: [
            {
              id: "4-0",
              fields: {
                kind: "trade",
                payload: JSON.stringify(tradePayload())
              }
            }
          ]
        }
      ])
    });
    const consumer = createMarketConsumer({
      bus: redis,
      stream: "market.trade.BTCUSDT",
      group: "engine",
      consumer: "engine-1",
      runner: {
        handleMarketEvent: vi.fn(async (event: LiveMarketEvent) => {
          handledEvents.push(event);
          return [];
        })
      },
      logger: logger()
    });

    const processed = await consumer.pollOnce();

    expect(processed).toBe(1);
    const event = handledEvents[0];
    if (event?.kind !== "trade") throw new Error("Expected trade event");
    expect(event.trade).toMatchObject({
      symbol: "BTCUSDT",
      tradeId: "12345",
      eventTimeMs: 2_000,
      isBuyerMaker: false
    });
    expect(event.trade.price.toFixed()).toBe("100.5");
    expect(event.trade.quantity.toFixed()).toBe("0.25");
    expect(redis.xAck).toHaveBeenCalledWith("market.trade.BTCUSDT", "engine", "4-0");
  });

  it("parses depth messages as book snapshots and routes them to the strategy runner", async () => {
    const handledEvents: LiveMarketEvent[] = [];
    const redis = bus({
      xReadGroup: vi.fn(async () => [
        {
          stream: "market.book.BTCUSDT",
          messages: [
            {
              id: "5-0",
              fields: {
                kind: "depth",
                payload: JSON.stringify(bookPayload())
              }
            }
          ]
        }
      ])
    });
    const consumer = createMarketConsumer({
      bus: redis,
      stream: "market.book.BTCUSDT",
      group: "engine",
      consumer: "engine-1",
      runner: {
        handleMarketEvent: vi.fn(async (event: LiveMarketEvent) => {
          handledEvents.push(event);
          return [];
        })
      },
      logger: logger()
    });

    const processed = await consumer.pollOnce();

    expect(processed).toBe(1);
    const event = handledEvents[0];
    if (event?.kind !== "book") throw new Error("Expected book event");
    expect(event.book.symbol).toBe("BTCUSDT");
    expect(event.book.eventTimeMs).toBe(2_100);
    expect(event.book.bids[0]?.price.toFixed()).toBe("100.4");
    expect(event.book.bids[0]?.quantity.toFixed()).toBe("1.5");
    expect(event.book.asks[0]?.price.toFixed()).toBe("100.6");
    expect(event.book.asks[0]?.quantity.toFixed()).toBe("2.5");
    expect(redis.xAck).toHaveBeenCalledWith("market.book.BTCUSDT", "engine", "5-0");
  });

  it("leaves messages pending when the strategy runner fails", async () => {
    const error = new Error("publisher unavailable");
    const redis = bus({
      xReadGroup: vi.fn(async () => [
        {
          stream: "market.kline.BTCUSDT.1m",
          messages: [
            {
              id: "3-0",
              fields: {
                kind: "kline",
                payload: JSON.stringify(candlePayload())
              }
            }
          ]
        }
      ])
    });
    const log = logger();
    const consumer = createMarketConsumer({
      bus: redis,
      stream: "market.kline.BTCUSDT.1m",
      group: "engine",
      consumer: "engine-1",
      runner: {
        handleMarketEvent: vi.fn(async () => {
          throw error;
        })
      },
      logger: log
    });

    const processed = await consumer.pollOnce();

    expect(processed).toBe(0);
    expect(redis.xAck).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      {
        error,
        stream: "market.kline.BTCUSDT.1m",
        messageId: "3-0"
      },
      "market message processing failed; message left pending for retry"
    );
  });
});
