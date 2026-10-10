import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { describe, expect, it } from "vitest";
import { Decimal } from "../../packages/core/src/index.ts";
import { createLiveStrategyRunner } from "../../apps/engine/src/live-strategy-runner.ts";
import { createEngineEmaCrossoverStrategy } from "../../apps/engine/src/ema-crossover-strategy.ts";
import { createEmaCrossover } from "../../apps/backtest-worker/src/strategies/ema-crossover.ts";
import { createRecordedSessionCandleFeed } from "../../apps/backtest-worker/src/feeds/recorded-session-feed.ts";
import { createSimBroker } from "../../apps/backtest-worker/src/broker/create-sim-broker.ts";
import { runBacktest } from "../../apps/backtest-worker/src/runtime/run-backtest.ts";

const intervalMs = 900000;
function candle(openTimeMs, price) {
  return {
    symbol: "BTCUSDT",
    interval: "15m",
    openTimeMs,
    closeTimeMs: openTimeMs + intervalMs - 1,
    open: new Decimal(price),
    high: new Decimal(price),
    low: new Decimal(price),
    close: new Decimal(price),
    volume: new Decimal(1),
    closed: true
  };
}
function broker() {
  return createSimBroker({
    symbol: "BTCUSDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    initialQuoteBalance: new Decimal(1000),
    slippageBps: new Decimal(0),
    takerFeeRate: new Decimal(0)
  });
}
function normalized(intent, nowMs) {
  return {
    at: nowMs,
    symbol: intent.symbol,
    side: intent.side,
    type: intent.type,
    quantity: new Decimal(intent.quantity).toFixed(),
    price: intent.limitPrice === undefined ? undefined : new Decimal(intent.limitPrice).toFixed(),
    reason: intent.reason
  };
}
async function verify(candles, expectedSignals) {
  expect(candles.length).toBeGreaterThan(5);
  const options = {
    symbol: "BTCUSDT",
    interval: "15m",
    fastPeriod: 2,
    slowPeriod: 3,
    quantity: new Decimal("0.0002")
  };
  const liveBroker = broker();
  const live = [];
  let now = candles[0].openTimeMs;
  const runner = createLiveStrategyRunner({
    strategy: createEngineEmaCrossoverStrategy(options),
    nowMs: () => now,
    signalTtlMs: 5000,
    position: () => liveBroker.position(),
    balance: liveBroker.balance,
    publishSignal: async (signal) => {
      live.push(normalized(signal.intent, signal.createdAtMs));
      liveBroker.submit(signal.intent, now);
      return "1-0";
    }
  });
  for (const bar of candles) {
    liveBroker.processCandle(bar);
    now = bar.closeTimeMs;
    await runner.handleMarketEvent({ kind: "candle", candle: bar });
  }
  const recorded = candles
    .map((bar) =>
      JSON.stringify({
        kind: "kline",
        symbol: bar.symbol,
        candle: {
          ...bar,
          open: bar.open.toFixed(),
          high: bar.high.toFixed(),
          low: bar.low.toFixed(),
          close: bar.close.toFixed(),
          volume: bar.volume.toFixed()
        }
      })
    )
    .join("\n");
  const replayBroker = broker();
  const replay = [];
  await runBacktest({
    strategy: createEmaCrossover(options),
    initialEquity: new Decimal(1000),
    request: {
      symbol: "BTCUSDT",
      interval: "15m",
      fromMs: candles[0].openTimeMs,
      toMs: candles.at(-1).closeTimeMs + 1
    },
    feed: createRecordedSessionCandleFeed("in-memory.ndjson", { readFile: async () => recorded }),
    broker: {
      ...replayBroker,
      submit(intent, submittedAtMs) {
        replay.push(normalized(intent, submittedAtMs));
        replayBroker.submit(intent, submittedAtMs);
      }
    }
  });
  expect(live.length).toBeGreaterThan(0);
  expect(replay).toEqual(live);
  if (expectedSignals !== undefined) expect(replay).toEqual(expectedSignals);
  return { bars: candles.length, signals: live.length };
}

describe("live/backtest signal parity", () => {
  it.skipIf(!process.env.PARITY_CANDLE_SESSION)(
    "replays clean captured klines against saved live-runner decisions",
    async () => {
      const directory = process.env.PARITY_CANDLE_SESSION;
      const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
      expect(manifest.liveClosedBars).toBeGreaterThan(0);
      expect(manifest.signals).toBeGreaterThan(0);
      const records = (await readFile(join(directory, "events.ndjson"), "utf8"))
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line));
      expect(records.filter((record) => record.source === "websocket")).toHaveLength(
        manifest.liveClosedBars
      );
      expect(records).toHaveLength(manifest.bars);
      const candles = [];
      for await (const bar of createRecordedSessionCandleFeed(
        join(directory, "events.ndjson")
      ).read({
        symbol: "BTCUSDT",
        interval: "15m",
        fromMs: records[0].candle.openTimeMs,
        toMs: records.at(-1).candle.closeTimeMs + 1
      }))
        candles.push(bar);
      expect(candles).toHaveLength(manifest.bars);
      for (let i = 1; i < candles.length; i++)
        expect(candles[i].openTimeMs).toBe(candles[i - 1].closeTimeMs + 1);
      const saved = (await readFile(join(directory, "signals.ndjson"), "utf8"))
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line))
        .map((record) => normalized(record.signal.intent, record.decisionAtMs));
      expect(saved).toHaveLength(manifest.signals);
      console.log("Clean captured-candle parity", await verify(candles, saved));
    }
  );
  it("matches nonempty crossover signals on recorded-format deterministic candles", async () => {
    const prices = [100, 99, 98, 97, 101, 105, 110, 90, 85, 80, 120, 125, 130, 70, 60, 50];
    await verify(prices.map((price, index) => candle(index * intervalMs, price)));
  });
  it.skipIf(!process.env.PARITY_TRADE_SESSION)(
    "matches on bars explicitly derived from the real trade recording",
    async () => {
      const bars = new Map();
      const boundaries = new Map();
      const lines = createInterface({
        input: createReadStream(process.env.PARITY_TRADE_SESSION),
        crlfDelay: Infinity
      });
      for await (const line of lines) {
        if (!line.trim()) continue;
        const record = JSON.parse(line);
        if (record.kind !== "trade" || record.symbol !== "BTCUSDT") continue;
        const trade = record.trade;
        if (!Number.isSafeInteger(trade.eventTimeMs)) throw new Error("Invalid recorded timestamp");
        const price = new Decimal(trade.price);
        const quantity = new Decimal(trade.quantity);
        if (!price.isFinite() || price.lte(0) || !quantity.isFinite() || quantity.lte(0))
          throw new Error("Invalid recorded trade");
        const start = Math.floor(trade.eventTimeMs / intervalMs) * intervalMs;
        const bar = bars.get(start);
        const key = [trade.eventTimeMs, BigInt(trade.tradeId)];
        if (bar) {
          bar.high = Decimal.max(bar.high, price);
          bar.low = Decimal.min(bar.low, price);
          bar.volume = bar.volume.plus(quantity);
          const edge = boundaries.get(start);
          if (key[0] < edge.first[0] || (key[0] === edge.first[0] && key[1] < edge.first[1])) {
            bar.open = price;
            edge.first = key;
          }
          if (key[0] > edge.last[0] || (key[0] === edge.last[0] && key[1] > edge.last[1])) {
            bar.close = price;
            edge.last = key;
          }
        } else {
          bars.set(start, { ...candle(start, price), volume: quantity });
          boundaries.set(start, { first: key, last: key });
        }
      }
      // Drop recording boundary buckets; these are derived trades, not recorded exchange klines.
      const candles = [...bars.values()].sort((a, b) => a.openTimeMs - b.openTimeMs).slice(1, -1);
      const segments = [[]];
      for (const bar of candles) {
        const current = segments.at(-1);
        if (current.length && bar.openTimeMs - current.at(-1).openTimeMs !== intervalMs)
          segments.push([]);
        segments.at(-1).push(bar);
      }
      // Do not pretend the old soak's multi-hour gap was continuous market data.
      const longest = segments.sort((a, b) => b.length - a.length)[0];
      console.log("Trade-derived contiguous-segment parity", {
        segments: segments.length,
        ...(await verify(longest))
      });
    },
    30000
  );
});
