import type { Decimal, Fill, Strategy } from "@meridian/core";
import type { CandleFeed, CandleFeedRequest } from "../feeds/candle-feed.js";
import type { SimBroker } from "../broker/sim-broker.js";
import { calculateBacktestMetrics } from "../metrics/backtest-metrics.js";
import { createBacktestContext } from "./strategy-context.js";

export interface BacktestRunOptions {
  readonly feed: CandleFeed;
  readonly request: CandleFeedRequest;
  readonly strategy: Strategy;
  readonly broker: SimBroker;
  readonly initialEquity: Decimal;
}

export async function runBacktest(options: BacktestRunOptions) {
  const { feed, request, strategy, broker, initialEquity } = options;
  calculateBacktestMetrics(initialEquity, [], 0);
  if (broker.position().symbol !== request.symbol) {
    throw new Error("Broker symbol does not match feed request");
  }

  let nowMs = request.fromMs;
  let lastCloseMs = request.fromMs - 1;
  const ctx = createBacktestContext(broker, () => nowMs);
  const fills: Fill[] = [];
  const equityCurve: { tsMs: number; equity: Decimal }[] = [];

  await strategy.onInit?.(ctx);

  for await (const candle of feed.read(request)) {
    if (
      !candle.closed ||
      candle.symbol !== request.symbol ||
      candle.interval !== request.interval ||
      !Number.isSafeInteger(candle.openTimeMs) ||
      !Number.isSafeInteger(candle.closeTimeMs) ||
      candle.openTimeMs < request.fromMs ||
      candle.closeTimeMs >= request.toMs ||
      candle.closeTimeMs < candle.openTimeMs ||
      candle.openTimeMs <= lastCloseMs
    ) {
      throw new Error("Invalid or out-of-order backtest candle");
    }

    nowMs = candle.openTimeMs;
    for (const fill of broker.processCandle(candle)) {
      fills.push(fill);
      strategy.onFill?.(fill, ctx);
    }

    nowMs = candle.closeTimeMs;
    strategy.onCandle?.(candle, ctx);
    equityCurve.push({
      tsMs: nowMs,
      equity: broker.equity(candle.close)
    });
    lastCloseMs = candle.closeTimeMs;
  }

  if (equityCurve.length === 0) {
    throw new Error("No candles found for requested backtest");
  }

  return {
    fills,
    equityCurve,
    metrics: calculateBacktestMetrics(
      initialEquity,
      equityCurve.map((point) => point.equity),
      fills.length
    )
  };
}
