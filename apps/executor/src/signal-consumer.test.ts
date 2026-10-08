import {
  Decimal,
  serializeSignal,
  type GatewayOrderResult,
  type Signal
} from "@meridian/core";
import type { RedisStreamClient } from "@meridian/bus";
import { describe, expect, it, vi } from "vitest";

import { createSignalConsumer, type SignalConsumerLogger } from "./signal-consumer.js";

function signal(override: Partial<Signal> = {}): Signal {
  return {
    signalId: "sig_1",
    strategyId: "ema",
    createdAtMs: 1_000,
    validUntilMs: 2_000,
    intent: {
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: new Decimal("0.0002"),
      limitPrice: new Decimal("83000.91"),
      reason: "EMA bullish crossover"
    },
    ...override
  };
}

function signalMessage(id: string, value: Signal) {
  return {
    id,
    fields: {
      kind: "signal",
      signalId: value.signalId,
      payload: JSON.stringify(serializeSignal(value))
    }
  };
}

function orderResult(clientOrderId: string): GatewayOrderResult {
  return {
    clientOrderId,
    exchangeOrderId: "123",
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    status: "NEW",
    executedQuantity: new Decimal("0"),
    cumulativeQuoteQuantity: new Decimal("0"),
    fills: [],
    eventTimeMs: 1_500
  };
}

function logger(): SignalConsumerLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

type MockBus = RedisStreamClient;

function bus(overrides: Partial<MockBus> = {}): MockBus {
  return {
    xAdd: vi.fn(),
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

describe("createSignalConsumer", () => {
  it("creates the signals consumer group from the beginning of the stream", async () => {
    const redis = bus();
    const consumer = createSignalConsumer({
      bus: redis,
      group: "executor",
      consumer: "executor-1",
      logger: logger(),
      store: { recordPendingOrder: vi.fn() },
      exchange: { placeOrder: vi.fn() },
      clientOrderIdPrefix: "mrd",
      nowMs: () => 1_500
    });

    await consumer.ensureReady();

    expect(redis.xGroupCreate).toHaveBeenCalledWith("signals", "executor", "0", {
      mkStream: true
    });
  });

  it("reads fresh signals, processes them, and acknowledges successful submissions", async () => {
    const redis = bus({
      xReadGroup: vi.fn(async () => [
        {
          stream: "signals",
          messages: [signalMessage("1-0", signal())]
        }
      ])
    });
    const log = logger();
    const store = {
      recordPendingOrder: vi.fn(async () => undefined)
    };
    const exchange = {
      placeOrder: vi.fn(async (request) => orderResult(request.clientOrderId))
    };
    const consumer = createSignalConsumer({
      bus: redis,
      group: "executor",
      consumer: "executor-1",
      logger: log,
      store,
      exchange,
      clientOrderIdPrefix: "mrd",
      nowMs: () => 1_500,
      readCount: 5,
      blockMs: 250
    });

    const results = await consumer.pollOnce();

    expect(redis.xReadGroup).toHaveBeenCalledWith(
      "executor",
      "executor-1",
      [{ key: "signals", id: ">" }],
      { count: 5, blockMs: 250 }
    );
    expect(results).toMatchObject([
      {
        outcome: "submitted",
        signalId: "sig_1"
      }
    ]);
    expect(store.recordPendingOrder).toHaveBeenCalledTimes(1);
    expect(exchange.placeOrder).toHaveBeenCalledTimes(1);
    expect(redis.xAck).toHaveBeenCalledWith("signals", "executor", "1-0");
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ signalId: "sig_1" }),
      "signal submitted"
    );
  });

  it("claims stale pending signals and processes them through the same handler", async () => {
    const redis = bus({
      xAutoClaim: vi.fn(async () => ({
        nextStartId: "0-0",
        messages: [signalMessage("2-0", signal({ signalId: "sig_stale" }))]
      }))
    });
    const exchange = {
      placeOrder: vi.fn(async (request) => orderResult(request.clientOrderId))
    };
    const consumer = createSignalConsumer({
      bus: redis,
      group: "executor",
      consumer: "executor-1",
      logger: logger(),
      store: { recordPendingOrder: vi.fn(async () => undefined) },
      exchange,
      clientOrderIdPrefix: "mrd",
      nowMs: () => 1_500,
      readCount: 3,
      staleMinIdleMs: 60_000
    });

    const results = await consumer.claimStaleOnce();

    expect(redis.xAutoClaim).toHaveBeenCalledWith(
      "signals",
      "executor",
      "executor-1",
      60_000,
      "0-0",
      { count: 3 }
    );
    expect(results).toMatchObject([
      {
        outcome: "submitted",
        signalId: "sig_stale"
      }
    ]);
    expect(redis.xAck).toHaveBeenCalledWith("signals", "executor", "2-0");
  });

  it("logs failures and leaves failed messages unacknowledged for retry", async () => {
    const redis = bus({
      xReadGroup: vi.fn(async () => [
        {
          stream: "signals",
          messages: [signalMessage("3-0", signal({ signalId: "sig_fail" }))]
        }
      ])
    });
    const error = new Error("exchange unavailable");
    const log = logger();
    const consumer = createSignalConsumer({
      bus: redis,
      group: "executor",
      consumer: "executor-1",
      logger: log,
      store: { recordPendingOrder: vi.fn(async () => undefined) },
      exchange: {
        placeOrder: vi.fn(async () => {
          throw error;
        })
      },
      clientOrderIdPrefix: "mrd",
      nowMs: () => 1_500
    });

    const results = await consumer.pollOnce();

    expect(results).toEqual([]);
    expect(redis.xAck).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      {
        error,
        stream: "signals",
        messageId: "3-0"
      },
      "signal processing failed; message left pending for retry"
    );
  });
});
