import { Decimal, type Candle, type Strategy } from "@meridian/core";
import { describe, expect, it, vi } from "vitest";

import { createLiveStrategyRunner } from "./live-strategy-runner.js";

function candle(overrides: Partial<Candle> = {}): Candle {
  return {
    symbol: "BTCUSDT",
    interval: "1m",
    openTimeMs: 1_000,
    closeTimeMs: 1_999,
    open: new Decimal("100"),
    high: new Decimal("101"),
    low: new Decimal("99"),
    close: new Decimal("100.5"),
    volume: new Decimal("10"),
    closed: true,
    ...overrides
  };
}

describe("createLiveStrategyRunner", () => {
  it("runs strategy candle handlers and publishes submitted intents as expiring signals", async () => {
    const publishSignal = vi.fn(async () => "1-0");
    const strategy: Strategy = {
      id: "ema",
      onCandle(input, ctx) {
        ctx.submit({
          symbol: input.symbol,
          side: "BUY",
          type: "LIMIT",
          quantity: new Decimal("0.0002"),
          limitPrice: input.close,
          reason: "EMA bullish crossover"
        });
      }
    };
    const runner = createLiveStrategyRunner({
      strategy,
      publishSignal,
      nowMs: () => 2_500,
      signalTtlMs: 5_000
    });

    const signals = await runner.handleMarketEvent({
      kind: "candle",
      candle: candle()
    });

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      strategyId: "ema",
      createdAtMs: 2_500,
      validUntilMs: 7_500,
      intent: {
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        reason: "EMA bullish crossover"
      }
    });
    expect(signals[0]?.signalId).toMatch(/^sig_[A-Za-z0-9_-]{32}$/);
    expect(signals[0]?.intent.quantity.toFixed()).toBe("0.0002");
    expect(signals[0]?.intent.limitPrice?.toFixed()).toBe("100.5");
    expect(publishSignal).toHaveBeenCalledWith(signals[0]);
  });

  it("starts strategy initialization once before handling market events", async () => {
    const onInit = vi.fn();
    const onCandle = vi.fn();
    const runner = createLiveStrategyRunner({
      strategy: {
        id: "spy",
        onInit,
        onCandle
      },
      publishSignal: vi.fn(async () => "1-0"),
      nowMs: () => 2_500,
      signalTtlMs: 5_000
    });

    await runner.start();
    await runner.start();
    await runner.handleMarketEvent({ kind: "candle", candle: candle() });

    expect(onInit).toHaveBeenCalledTimes(1);
    expect(onCandle).toHaveBeenCalledTimes(1);
  });

  it("exposes live positions, balances, time, and logs through StrategyContext", async () => {
    const log = {
      info: vi.fn()
    };
    const position = vi.fn(() => ({
      symbol: "BTCUSDT",
      quantity: new Decimal("0.01"),
      avgEntry: new Decimal("90000"),
      realizedPnl: new Decimal("1.25")
    }));
    const balance = vi.fn(() => new Decimal("1000"));
    const strategy: Strategy = {
      id: "context-check",
      onCandle(input, ctx) {
        const currentPosition = ctx.position(input.symbol);
        const freeUsdt = ctx.balance("USDT");

        ctx.log("context observed", {
          quantity: currentPosition.quantity.toFixed(),
          freeUsdt: freeUsdt.toFixed(),
          now: ctx.now()
        });
      }
    };
    const runner = createLiveStrategyRunner({
      strategy,
      publishSignal: vi.fn(async () => "1-0"),
      nowMs: () => 2_500,
      signalTtlMs: 5_000,
      position,
      balance,
      logger: log
    });

    await runner.handleMarketEvent({ kind: "candle", candle: candle() });

    expect(position).toHaveBeenCalledWith("BTCUSDT");
    expect(balance).toHaveBeenCalledWith("USDT");
    expect(log.info).toHaveBeenCalledWith(
      {
        strategyId: "context-check",
        quantity: "0.01",
        freeUsdt: "1000",
        now: 2_500
      },
      "context observed"
    );
  });

  it("refreshes account state before strategy initialization and exposes it through context", async () => {
    const accountState = {
      refresh: vi.fn(async () => undefined),
      position: vi.fn(() => ({
        symbol: "BTCUSDT",
        quantity: new Decimal("0.25"),
        avgEntry: new Decimal("84000"),
        realizedPnl: new Decimal("12")
      })),
      balance: vi.fn(() => new Decimal("750")),
      balanceSnapshot: vi.fn()
    };
    const onInit = vi.fn((_ctx) => {
      const currentPosition = _ctx.position("BTCUSDT");
      const freeUsdt = _ctx.balance("USDT");

      expect(currentPosition.quantity.toString()).toBe("0.25");
      expect(freeUsdt.toString()).toBe("750");
    });
    const runner = createLiveStrategyRunner({
      strategy: {
        id: "account-backed",
        onInit
      },
      publishSignal: vi.fn(async () => "1-0"),
      nowMs: () => 2_500,
      signalTtlMs: 5_000,
      accountState
    });

    await runner.start();

    expect(accountState.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      onInit.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    );
    expect(accountState.position).toHaveBeenCalledWith("BTCUSDT");
    expect(accountState.balance).toHaveBeenCalledWith("USDT");
  });

  it("refreshes account state before market events so strategies see the latest snapshot", async () => {
    const accountState = {
      refresh: vi.fn(async () => undefined),
      position: vi.fn(() => ({
        symbol: "BTCUSDT",
        quantity: new Decimal("0.5"),
        avgEntry: new Decimal("83000"),
        realizedPnl: new Decimal("5")
      })),
      balance: vi.fn(() => new Decimal("500")),
      balanceSnapshot: vi.fn()
    };
    const onCandle = vi.fn((_input, ctx) => {
      if (ctx.position("BTCUSDT").quantity.gt(0)) {
        ctx.submit({
          symbol: "BTCUSDT",
          side: "SELL",
          type: "MARKET",
          quantity: new Decimal("0.1"),
          reason: "account-backed sell"
        });
      }
    });
    const runner = createLiveStrategyRunner({
      strategy: {
        id: "account-backed-event",
        onCandle
      },
      publishSignal: vi.fn(async () => "1-0"),
      nowMs: () => 2_500,
      signalTtlMs: 5_000,
      accountState
    });

    const signals = await runner.handleMarketEvent({ kind: "candle", candle: candle() });

    expect(accountState.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      onCandle.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    );
    expect(signals).toHaveLength(1);
    expect(signals[0]?.intent.side).toBe("SELL");
  });

  it("skips strategy execution and signal publishing while strategy is paused", async () => {
    const onCandle = vi.fn((input: Candle, ctx) => {
      ctx.submit({
        symbol: input.symbol,
        side: "BUY",
        type: "MARKET",
        quantity: new Decimal("0.0002"),
        reason: "should not publish"
      });
    });
    const publishSignal = vi.fn(async () => "1-0");
    const logger = { info: vi.fn() };
    const runner = createLiveStrategyRunner({
      strategy: {
        id: "paused-strategy",
        onCandle
      },
      publishSignal,
      nowMs: () => 2_500,
      signalTtlMs: 5_000,
      logger,
      isStrategyPaused: vi.fn(async () => true)
    });

    const signals = await runner.handleMarketEvent({ kind: "candle", candle: candle() });

    expect(signals).toEqual([]);
    expect(onCandle).not.toHaveBeenCalled();
    expect(publishSignal).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      { strategyId: "paused-strategy" },
      "paused strategy skipped"
    );
  });

  it("fails closed when strategy pause state cannot be read", async () => {
    const runner = createLiveStrategyRunner({
      strategy: {
        id: "pause-query-fails",
        onCandle(input, ctx) {
          ctx.submit({
            symbol: input.symbol,
            side: "BUY",
            type: "MARKET",
            quantity: new Decimal("0.0002"),
            reason: "should not publish"
          });
        }
      },
      publishSignal: vi.fn(async () => "1-0"),
      nowMs: () => 2_500,
      signalTtlMs: 5_000,
      isStrategyPaused: vi.fn(async () => {
        throw new Error("pause state unavailable");
      })
    });

    await expect(runner.handleMarketEvent({ kind: "candle", candle: candle() })).rejects.toThrow(
      "pause state unavailable"
    );
  });

  it("creates deterministic but distinct signal ids for multiple submitted intents", async () => {
    const strategy: Strategy = {
      id: "multi",
      onCandle(input, ctx) {
        ctx.submit({
          symbol: input.symbol,
          side: "BUY",
          type: "MARKET",
          quantity: new Decimal("0.0002"),
          reason: "first intent"
        });
        ctx.submit({
          symbol: input.symbol,
          side: "SELL",
          type: "LIMIT",
          quantity: new Decimal("0.0001"),
          limitPrice: new Decimal("101"),
          reason: "second intent"
        });
      }
    };
    const options = {
      strategy,
      publishSignal: vi.fn(async () => "1-0"),
      nowMs: () => 2_500,
      signalTtlMs: 5_000
    };

    const firstRun = await createLiveStrategyRunner(options).handleMarketEvent({
      kind: "candle",
      candle: candle()
    });
    const secondRun = await createLiveStrategyRunner(options).handleMarketEvent({
      kind: "candle",
      candle: candle()
    });

    expect(firstRun).toHaveLength(2);
    expect(firstRun[0]?.signalId).not.toBe(firstRun[1]?.signalId);
    expect(firstRun.map((signal) => signal.signalId)).toEqual(
      secondRun.map((signal) => signal.signalId)
    );
  });

  it("ignores stale market events before running the strategy", async () => {
    const log = {
      warn: vi.fn()
    };
    const onCandle = vi.fn();
    const publishSignal = vi.fn(async () => "1-0");
    const runner = createLiveStrategyRunner({
      strategy: {
        id: "stale-guard",
        onCandle
      },
      publishSignal,
      nowMs: () => 10_000,
      signalTtlMs: 5_000,
      maxMarketDataAgeMs: 1_000,
      logger: log
    });

    const signals = await runner.handleMarketEvent({
      kind: "candle",
      candle: candle({ closeTimeMs: 8_999 })
    });

    expect(signals).toEqual([]);
    expect(onCandle).not.toHaveBeenCalled();
    expect(publishSignal).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      {
        strategyId: "stale-guard",
        eventTimeMs: 8_999,
        nowMs: 10_000,
        ageMs: 1_001,
        maxMarketDataAgeMs: 1_000
      },
      "stale market event ignored"
    );
  });

  it("ignores market events from the future", async () => {
    const onCandle = vi.fn();
    const runner = createLiveStrategyRunner({
      strategy: {
        id: "future-guard",
        onCandle
      },
      publishSignal: vi.fn(async () => "1-0"),
      nowMs: () => 10_000,
      signalTtlMs: 5_000,
      maxMarketDataAgeMs: 1_000
    });

    const signals = await runner.handleMarketEvent({
      kind: "candle",
      candle: candle({ closeTimeMs: 10_001 })
    });

    expect(signals).toEqual([]);
    expect(onCandle).not.toHaveBeenCalled();
  });

  it("runs strategies for market events at the stale-data boundary", async () => {
    const onCandle = vi.fn((input: Candle, ctx) => {
      ctx.submit({
        symbol: input.symbol,
        side: "BUY",
        type: "MARKET",
        quantity: new Decimal("0.0002"),
        reason: "fresh enough"
      });
    });
    const publishSignal = vi.fn(async () => "1-0");
    const runner = createLiveStrategyRunner({
      strategy: {
        id: "fresh-boundary",
        onCandle
      },
      publishSignal,
      nowMs: () => 10_000,
      signalTtlMs: 5_000,
      maxMarketDataAgeMs: 1_000
    });

    const signals = await runner.handleMarketEvent({
      kind: "candle",
      candle: candle({ closeTimeMs: 9_000 })
    });

    expect(onCandle).toHaveBeenCalledTimes(1);
    expect(signals).toHaveLength(1);
    expect(publishSignal).toHaveBeenCalledWith(signals[0]);
  });
});
