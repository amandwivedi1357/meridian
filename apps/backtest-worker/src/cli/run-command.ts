import { Decimal } from "@meridian/core";
import {
  createTimescaleCandleFeed,
  type TimescaleCandleFeedDeps
} from "../feeds/timescale-candle-feed.js";
import { createEmaCrossover } from "../strategies/ema-crossover.js";
import { createSimBroker } from "../broker/create-sim-broker.js";
import { runBacktest } from "../runtime/run-backtest.js";
import { parseBacktestArgs } from "./arguments.js";

export async function runBacktestCommand(args: readonly string[], deps: TimescaleCandleFeedDeps) {
  const { strategy: name, request } = parseBacktestArgs(args);
  const initialEquity = new Decimal(10000);
  const quantity = new Decimal("0.001");
  const slippageBps = new Decimal(10);
  const takerFeeRate = new Decimal("0.001");

  const strategy = createEmaCrossover({
    symbol: request.symbol,
    interval: request.interval,
    fastPeriod: 12,
    slowPeriod: 26,
    quantity
  });
  const broker = createSimBroker({
    symbol: request.symbol,
    baseAsset: "BTC",
    quoteAsset: "USDT",
    initialQuoteBalance: initialEquity,
    slippageBps,
    takerFeeRate
  });
  const result = await runBacktest({
    feed: createTimescaleCandleFeed(deps),
    request,
    strategy,
    broker,
    initialEquity
  });

  return {
    strategy: name,
    symbol: request.symbol,
    interval: request.interval,
    from: new Date(request.fromMs).toISOString(),
    to: new Date(request.toMs).toISOString(),
    fastPeriod: 12,
    slowPeriod: 26,
    quantity: quantity.toString(),
    initialEquity: initialEquity.toString(),
    slippageBps: slippageBps.toString(),
    takerFeeRate: takerFeeRate.toString(),
    candleCount: result.equityCurve.length,
    tradeCount: result.metrics.tradeCount,
    totalReturnPct: result.metrics.totalReturnPct.toFixed(6),
    maxDrawdownPct: result.metrics.maxDrawdownPct.toFixed(6)
  };
}
