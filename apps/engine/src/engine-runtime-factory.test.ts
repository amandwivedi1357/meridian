import { Decimal, type Strategy } from "@meridian/core";
import { describe, expect, it, vi } from "vitest";

import { createEngineRuntimeFromDeps } from "./engine-runtime-factory.js";

function strategy(): Strategy {
  return {
    id: "test-strategy",
    onCandle(candle, ctx) {
      ctx.submit({
        symbol: candle.symbol,
        side: "BUY",
        type: "MARKET",
        quantity: new Decimal("0.0002"),
        reason: "test signal"
      });
    }
  };
}

describe("createEngineRuntimeFromDeps", () => {
  it("creates a kline market consumer and publishes strategy signals", async () => {
    const xReadGroup = vi.fn(async () => [
      {
        stream: "market.kline.BTCUSDT.15m",
        messages: [
          {
            id: "1-0",
            fields: {
              kind: "kline",
              payload: JSON.stringify({
                symbol: "BTCUSDT",
                interval: "15m",
                openTimeMs: 1_000,
                closeTimeMs: 2_000,
                open: "100",
                high: "101",
                low: "99",
                close: "100.5",
                volume: "1",
                closed: true
              })
            }
          }
        ]
      }
    ]);
    const bus = {
      xAdd: vi.fn(async () => "2-0"),
      xGroupCreate: vi.fn(async () => "OK"),
      xReadGroup,
      xAck: vi.fn(async () => 1),
      xAutoClaim: vi.fn(async () => ({ nextStartId: "0-0", messages: [] }))
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    const runtime = createEngineRuntimeFromDeps({
      bus,
      strategy: strategy(),
      symbol: "BTCUSDT",
      interval: "15m",
      logger,
      group: "engine",
      consumer: "engine-1",
      signalTtlMs: 5_000,
      maxMarketDataAgeMs: 10_000,
      nowMs: () => 2_500,
      readCount: 3,
      blockMs: 25
    });

    await runtime.start();
    const processed = await runtime.pollMarketOnce();

    expect(bus.xGroupCreate).toHaveBeenCalledWith("market.kline.BTCUSDT.15m", "engine", "0", {
      mkStream: true
    });
    expect(xReadGroup).toHaveBeenCalledWith(
      "engine",
      "engine-1",
      [{ key: "market.kline.BTCUSDT.15m", id: ">" }],
      { count: 3, blockMs: 25 }
    );
    expect(processed).toBe(1);
    expect(bus.xAdd).toHaveBeenCalledWith(
      "signals",
      "*",
      expect.objectContaining({
        kind: "signal"
      })
    );
    expect(bus.xAck).toHaveBeenCalledWith("market.kline.BTCUSDT.15m", "engine", "1-0");
  });

  it("passes account state into the strategy runner before publishing signals", async () => {
    const xReadGroup = vi.fn(async () => [
      {
        stream: "market.kline.BTCUSDT.15m",
        messages: [
          {
            id: "1-0",
            fields: {
              kind: "kline",
              payload: JSON.stringify({
                symbol: "BTCUSDT",
                interval: "15m",
                openTimeMs: 1_000,
                closeTimeMs: 2_000,
                open: "100",
                high: "101",
                low: "99",
                close: "100.5",
                volume: "1",
                closed: true
              })
            }
          }
        ]
      }
    ]);
    const bus = {
      xAdd: vi.fn(async () => "2-0"),
      xGroupCreate: vi.fn(async () => "OK"),
      xReadGroup,
      xAck: vi.fn(async () => 1),
      xAutoClaim: vi.fn(async () => ({ nextStartId: "0-0", messages: [] }))
    };
    const accountState = {
      refresh: vi.fn(async () => undefined),
      position: vi.fn(() => ({
        symbol: "BTCUSDT",
        quantity: new Decimal("0.4"),
        avgEntry: new Decimal("83000"),
        realizedPnl: new Decimal("0")
      })),
      balance: vi.fn(() => new Decimal("1000"))
    };
    const sellIfLong: Strategy = {
      id: "sell-if-long",
      onCandle(candle, ctx) {
        if (ctx.position(candle.symbol).quantity.gt(0)) {
          ctx.submit({
            symbol: candle.symbol,
            side: "SELL",
            type: "MARKET",
            quantity: new Decimal("0.1"),
            reason: "account-backed exit"
          });
        }
      }
    };
    const runtime = createEngineRuntimeFromDeps({
      bus,
      strategy: sellIfLong,
      symbol: "BTCUSDT",
      interval: "15m",
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      accountState,
      group: "engine",
      consumer: "engine-1",
      signalTtlMs: 5_000,
      maxMarketDataAgeMs: 10_000,
      nowMs: () => 2_500
    });

    await runtime.pollMarketOnce();

    expect(accountState.refresh).toHaveBeenCalled();
    expect(accountState.position).toHaveBeenCalledWith("BTCUSDT");
    expect(bus.xAdd).toHaveBeenCalledWith(
      "signals",
      "*",
      expect.objectContaining({
        payload: expect.stringContaining('"side":"SELL"')
      })
    );
  });

  it("does not publish signals when strategy control marks the strategy paused", async () => {
    const xReadGroup = vi.fn(async () => [
      {
        stream: "market.kline.BTCUSDT.15m",
        messages: [
          {
            id: "1-0",
            fields: {
              kind: "kline",
              payload: JSON.stringify({
                symbol: "BTCUSDT",
                interval: "15m",
                openTimeMs: 1_000,
                closeTimeMs: 2_000,
                open: "100",
                high: "101",
                low: "99",
                close: "100.5",
                volume: "1",
                closed: true
              })
            }
          }
        ]
      }
    ]);
    const bus = {
      xAdd: vi.fn(async () => "2-0"),
      xGroupCreate: vi.fn(async () => "OK"),
      xReadGroup,
      xAck: vi.fn(async () => 1),
      xAutoClaim: vi.fn(async () => ({ nextStartId: "0-0", messages: [] }))
    };
    const runtime = createEngineRuntimeFromDeps({
      bus,
      strategy: strategy(),
      symbol: "BTCUSDT",
      interval: "15m",
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      group: "engine",
      consumer: "engine-1",
      signalTtlMs: 5_000,
      maxMarketDataAgeMs: 10_000,
      nowMs: () => 2_500,
      isStrategyPaused: vi.fn(async () => true)
    });

    const processed = await runtime.pollMarketOnce();

    expect(processed).toBe(1);
    expect(bus.xAdd).not.toHaveBeenCalled();
    expect(bus.xAck).toHaveBeenCalledWith("market.kline.BTCUSDT.15m", "engine", "1-0");
  });
});
