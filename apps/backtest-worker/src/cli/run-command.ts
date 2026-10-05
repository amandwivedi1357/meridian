import { Decimal } from "@meridian/core";
import {
  createTimescaleCandleFeed,
  type TimescaleCandleFeedDeps
} from "../feeds/timescale-candle-feed.js";
import { createEmaCrossover } from "../strategies/ema-crossover.js";
import { createSimBroker } from "../broker/create-sim-broker.js";
import { runBacktest } from "../runtime/run-backtest.js";
import {
  createBacktestResultWriter,
  type SqlQuery
} from "../results/backtest-result-writer.js";
import { parseBacktestArgs } from "./arguments.js";

export interface BacktestCommandDeps extends TimescaleCandleFeedDeps {
  readonly execute?: (query: SqlQuery) => Promise<void>;
  readonly nowMs?: () => number;
}

export async function runBacktestCommand(args: readonly string[], deps: BacktestCommandDeps) {
  const parsed = parseBacktestArgs(args);
  const { strategy: name, request } = parsed;
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
  const strategyParams = {
    fastPeriod: 12,
    slowPeriod: 26,
    quantity: quantity.toString(),
    initialEquity: initialEquity.toString(),
    slippageBps: slippageBps.toString(),
    takerFeeRate: takerFeeRate.toString()
  };

  let runId: string | undefined;
  if (parsed.saveRun) {
    if (deps.execute === undefined) {
      throw new Error("Saving backtest runs requires a SQL executor");
    }

    runId = parsed.runId ?? createRunId(name, request.symbol, request.interval, deps.nowMs?.() ?? Date.now());
    await createBacktestResultWriter({ execute: deps.execute }).save({
      runId,
      strategy: name,
      symbol: request.symbol,
      interval: request.interval,
      fromMs: request.fromMs,
      toMs: request.toMs,
      params: strategyParams,
      metrics: result.metrics,
      fills: result.fills,
      equityCurve: result.equityCurve
    });
  }

  return {
    ...(runId === undefined ? {} : { runId }),
    strategy: name,
    symbol: request.symbol,
    interval: request.interval,
    from: new Date(request.fromMs).toISOString(),
    to: new Date(request.toMs).toISOString(),
    ...strategyParams,
    candleCount: result.equityCurve.length,
    tradeCount: result.metrics.tradeCount,
    totalReturnPct: result.metrics.totalReturnPct.toFixed(6),
    buyAndHoldReturnPct: result.metrics.buyAndHoldReturnPct.toFixed(6),
    strategyVsBuyAndHoldPct: result.metrics.strategyVsBuyAndHoldPct.toFixed(6),
    cagrPct: result.metrics.cagrPct.toFixed(6),
    maxDrawdownPct: result.metrics.maxDrawdownPct.toFixed(6),
    sharpeRatio: result.metrics.sharpeRatio.toFixed(6),
    sortinoRatio: result.metrics.sortinoRatio.toFixed(6),
    winRatePct: result.metrics.winRatePct.toFixed(6),
    profitFactor: result.metrics.profitFactor.toFixed(6),
    exposurePct: result.metrics.exposurePct.toFixed(6)
  };
}

function createRunId(strategy: string, symbol: string, interval: string, nowMs: number): string {
  if (!Number.isSafeInteger(nowMs)) {
    throw new Error("Run id timestamp must be a safe integer");
  }
  return `${strategy}:${symbol}:${interval}:${new Date(nowMs).toISOString().replace(/[:.]/g, "-")}`;
}
