import { describe, expect, it, vi } from "vitest";
import { Decimal, type Candle, type Strategy } from "@meridian/core";
import { createSimBroker } from "../broker/create-sim-broker.js";
import { createEmaCrossover } from "../strategies/ema-crossover.js";
import type { CandleFeed } from "../feeds/candle-feed.js";
import { createRecordedSessionCandleFeed } from "../feeds/recorded-session-feed.js";
import { runBacktest } from "./run-backtest.js";

const fromMs = Date.UTC(2024, 0, 1);
const step = 900000;
const request = { symbol: "BTCUSDT", interval: "15m" as const, fromMs, toMs: fromMs + 10 * step };

function candle(index: number, close = 10, open = close): Candle {
  return {
    symbol: "BTCUSDT",
    interval: "15m",
    openTimeMs: fromMs + index * step,
    closeTimeMs: fromMs + (index + 1) * step - 1,
    open: new Decimal(open),
    high: new Decimal(Math.max(open, close)),
    low: new Decimal(Math.min(open, close)),
    close: new Decimal(close),
    volume: new Decimal(1),
    closed: true
  };
}

function feed(candles: readonly Candle[]): CandleFeed {
  return {
    async *read() {
      yield* candles;
    }
  };
}

function recordedLine(candle: Candle): string {
  return JSON.stringify({
    kind: "kline",
    symbol: candle.symbol,
    eventId: `${candle.interval}:${candle.openTimeMs}`,
    occurredAtMs: candle.closeTimeMs + 1,
    candle: {
      symbol: candle.symbol,
      interval: candle.interval,
      openTimeMs: candle.openTimeMs,
      closeTimeMs: candle.closeTimeMs,
      open: candle.open.toString(),
      high: candle.high.toString(),
      low: candle.low.toString(),
      close: candle.close.toString(),
      volume: candle.volume.toString(),
      closed: candle.closed
    }
  });
}

function broker(symbol = "BTCUSDT", slippage = "0", fee = "0") {
  return createSimBroker({
    symbol,
    baseAsset: symbol === "BTCUSDT" ? "BTC" : "ETH",
    quoteAsset: "USDT",
    initialQuoteBalance: new Decimal(1000),
    slippageBps: new Decimal(slippage),
    takerFeeRate: new Decimal(fee)
  });
}

const passive: Strategy = { id: "passive" };

describe("runBacktest", () => {
  it("awaits initialization, fills at the next open, and delivers fills before the closed candle", async () => {
    const events: string[] = [];
    const strategy: Strategy = {
      id: "event-order",
      async onInit(ctx) {
        await Promise.resolve();
        expect(ctx.now()).toBe(fromMs);
        events.push("init");
      },
      onCandle(c, ctx) {
        expect(ctx.now()).toBe(c.closeTimeMs);
        events.push(`candle:${c.openTimeMs}`);
        if (c.openTimeMs === fromMs)
          ctx.submit({
            symbol: "BTCUSDT",
            side: "BUY",
            type: "MARKET",
            quantity: new Decimal(1),
            reason: "test"
          });
      },
      onFill(fill, ctx) {
        expect(ctx.now()).toBe(fill.tsMs);
        expect(ctx.position("BTCUSDT").quantity.toString()).toBe("1");
        events.push(`fill:${fill.tsMs}`);
      }
    };
    const simBroker = broker();
    const result = await runBacktest({
      feed: feed([candle(0), candle(1, 25, 20)]),
      request,
      strategy,
      broker: simBroker,
      initialEquity: new Decimal(1000)
    });
    expect(events).toEqual([
      "init",
      `candle:${fromMs}`,
      `fill:${fromMs + step}`,
      `candle:${fromMs + step}`
    ]);
    expect(result.fills[0]?.price.toString()).toBe("20");
    expect(result.equityCurve.map((p) => p.equity.toString())).toEqual(["1000", "1005"]);
    expect(result.metrics.tradeCount).toBe(1);
    expect(result.metrics.totalReturnPct.toString()).toBe("0.5");
  });

  it("runs the real EMA and broker together without look-ahead fills", async () => {
    const strategy = createEmaCrossover({
      symbol: "BTCUSDT",
      interval: "15m",
      fastPeriod: 1,
      slowPeriod: 3,
      quantity: new Decimal(1)
    });
    const candles = [
      candle(0),
      candle(1),
      candle(2),
      candle(3, 12),
      candle(4, 8, 20),
      candle(5, 9, 30)
    ];
    const result = await runBacktest({
      feed: feed(candles),
      request,
      strategy,
      broker: broker(),
      initialEquity: new Decimal(1000)
    });
    expect(result.fills.map((f) => [f.side, f.tsMs, f.price.toString()])).toEqual([
      ["BUY", fromMs + 4 * step, "20"],
      ["SELL", fromMs + 5 * step, "30"]
    ]);
    expect(result.equityCurve.map((p) => p.equity.toString())).toEqual([
      "1000",
      "1000",
      "1000",
      "1000",
      "988",
      "1010"
    ]);
    expect(result.metrics.totalReturnPct.toString()).toBe("1");
    expect(result.metrics.buyAndHoldReturnPct.toString()).toBe("-10");
    expect(result.metrics.strategyVsBuyAndHoldPct.toString()).toBe("11");
    expect(result.metrics.maxDrawdownPct.toString()).toBe("1.2");
    expect(result.metrics.tradeCount).toBe(2);
    expect(result.metrics.winRatePct.toString()).toBe("100");
    expect(result.metrics.profitFactor.toString()).toBe("10");
    expect(result.metrics.exposurePct.toString()).toBe("16.666666666666666667");
  });

  it("produces identical serialized fills, equity, and metrics on two runs with the same inputs", async () => {
    const candles = [
      candle(0),
      candle(1),
      candle(2),
      candle(3, 12),
      candle(4, 8, 20),
      candle(5, 9, 30)
    ];
    const strategy = createEmaCrossover({
      symbol: "BTCUSDT",
      interval: "15m",
      fastPeriod: 1,
      slowPeriod: 3,
      quantity: new Decimal(1)
    });
    async function run() {
      return runBacktest({
        feed: feed(candles),
        request,
        strategy,
        broker: broker("BTCUSDT", "10", "0.001"),
        initialEquity: new Decimal(1000)
      });
    }
    const first = await run();
    const second = await run();
    expect(first.fills).toHaveLength(2);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.metrics.totalReturnPct.toString()).toBe("0.990001");
  });

  it("replays recorded session candles through the normal backtest path deterministically", async () => {
    const candles = [
      candle(0),
      candle(1),
      candle(2),
      candle(3, 12),
      candle(4, 8, 20),
      candle(5, 9, 30)
    ];
    const recording = [
      JSON.stringify({
        kind: "trade",
        symbol: "BTCUSDT",
        eventId: "trade-1",
        occurredAtMs: fromMs,
        trade: {}
      }),
      ...candles.map(recordedLine)
    ].join("\n");

    async function run() {
      return runBacktest({
        feed: createRecordedSessionCandleFeed("sessions/replay.ndjson", {
          readFile: async () => recording
        }),
        request,
        strategy: createEmaCrossover({
          symbol: "BTCUSDT",
          interval: "15m",
          fastPeriod: 1,
          slowPeriod: 3,
          quantity: new Decimal(1)
        }),
        broker: broker(),
        initialEquity: new Decimal(1000)
      });
    }

    const first = await run();
    const second = await run();

    expect(first.fills.map((fill) => [fill.side, fill.tsMs, fill.price.toString()])).toEqual([
      ["BUY", fromMs + 4 * step, "20"],
      ["SELL", fromMs + 5 * step, "30"]
    ]);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("does not force-fill a final-candle signal without a later open", async () => {
    const strategy = createEmaCrossover({
      symbol: "BTCUSDT",
      interval: "15m",
      fastPeriod: 1,
      slowPeriod: 3,
      quantity: new Decimal(1)
    });
    const result = await runBacktest({
      feed: feed([candle(0), candle(1), candle(2), candle(3, 12)]),
      request,
      strategy,
      broker: broker(),
      initialEquity: new Decimal(1000)
    });
    expect(result.fills).toEqual([]);
    expect(result.metrics.tradeCount).toBe(0);
  });

  it("marks an open position at the last close without forced liquidation", async () => {
    const strategy: Strategy = {
      id: "buy",
      onInit(ctx) {
        ctx.submit({
          symbol: "BTCUSDT",
          side: "BUY",
          type: "MARKET",
          quantity: new Decimal(1),
          reason: "buy"
        });
      }
    };
    const simBroker = broker();
    const result = await runBacktest({
      feed: feed([candle(0), candle(1, 120, 100)]),
      request,
      strategy,
      broker: simBroker,
      initialEquity: new Decimal(1000)
    });
    expect(result.metrics.totalReturnPct.toString()).toBe("2");
    expect(result.metrics.buyAndHoldReturnPct.toString()).toBe("1100");
    expect(result.metrics.strategyVsBuyAndHoldPct.toString()).toBe("-1098");
    expect(result.metrics.tradeCount).toBe(1);
    expect(result.metrics.exposurePct.toString()).toBe("50");
    expect(simBroker.position().quantity.toString()).toBe("1");
  });

  it("rejects empty data rather than reporting a successful zero-trade backtest", async () => {
    await expect(
      runBacktest({
        feed: feed([]),
        request,
        strategy: passive,
        broker: broker(),
        initialEquity: new Decimal(1000)
      })
    ).rejects.toThrow("No candles found for requested backtest");
  });

  it.each([
    { closed: false },
    { symbol: "ETHUSDT" },
    { interval: "1h" },
    { openTimeMs: fromMs - 1 },
    { closeTimeMs: request.toMs },
    { openTimeMs: NaN },
    { closeTimeMs: Infinity },
    { closeTimeMs: fromMs - 1 }
  ])("rejects invalid candles before strategy delivery %j", (override) => {
    const onCandle = vi.fn();
    return expect(
      runBacktest({
        feed: feed([{ ...candle(0), ...override }]),
        request,
        strategy: { id: "spy", onCandle },
        broker: broker(),
        initialEquity: new Decimal(1000)
      })
    )
      .rejects.toThrow("Invalid or out-of-order backtest candle")
      .then(() => expect(onCandle).not.toHaveBeenCalled());
  });

  it("rejects repeated or overlapping candles", async () => {
    for (const candles of [
      [candle(0), candle(0)],
      [candle(0), { ...candle(1), openTimeMs: candle(0).closeTimeMs }]
    ]) {
      await expect(
        runBacktest({
          feed: feed(candles),
          request,
          strategy: passive,
          broker: broker(),
          initialEquity: new Decimal(1000)
        })
      ).rejects.toThrow("Invalid or out-of-order backtest candle");
    }
  });

  it("rejects a broker symbol mismatch before strategy initialization", async () => {
    const onInit = vi.fn();
    await expect(
      runBacktest({
        feed: feed([candle(0)]),
        request,
        strategy: { id: "spy", onInit },
        broker: broker("ETHUSDT"),
        initialEquity: new Decimal(1000)
      })
    ).rejects.toThrow("Broker symbol does not match feed request");
    expect(onInit).not.toHaveBeenCalled();
  });

  it("propagates feed and strategy failures", async () => {
    const error = new Error("feed unavailable");
    const brokenFeed: CandleFeed = {
      read() {
        throw error;
      }
    };
    await expect(
      runBacktest({
        feed: brokenFeed,
        request,
        strategy: passive,
        broker: broker(),
        initialEquity: new Decimal(1000)
      })
    ).rejects.toBe(error);
    await expect(
      runBacktest({
        feed: feed([candle(0)]),
        request,
        strategy: {
          id: "broken",
          onCandle() {
            throw error;
          }
        },
        broker: broker(),
        initialEquity: new Decimal(1000)
      })
    ).rejects.toBe(error);
  });
});
