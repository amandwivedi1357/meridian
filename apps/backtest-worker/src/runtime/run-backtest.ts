import type { Decimal, Fill, Strategy } from "@meridian/core";
import { Decimal as DecimalCtor } from "@meridian/core";
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
  const closedTradePnls: Decimal[] = [];
  const equityCurve: { tsMs: number; equity: Decimal }[] = [];
  let firstClose: Decimal | null = null;
  let lastClose: Decimal | null = null;
  let exposureBars = 0;
  let totalBars = 0;
  let accountingQuantity = new DecimalCtor(0);
  let accountingAvgEntry = new DecimalCtor(0);

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

    firstClose ??= candle.close;
    lastClose = candle.close;

    nowMs = candle.openTimeMs;
    for (const fill of broker.processCandle(candle)) {
      fills.push(fill);
      const closedPnl = calculateClosedTradePnl(fill, accountingQuantity, accountingAvgEntry);
      if (closedPnl !== undefined) closedTradePnls.push(closedPnl.pnl);
      accountingQuantity = closedPnl?.quantity ?? nextAccountingQuantity(fill, accountingQuantity);
      accountingAvgEntry =
        closedPnl?.avgEntry ?? nextAccountingAvgEntry(fill, accountingQuantity, accountingAvgEntry);
      strategy.onFill?.(fill, ctx);
    }

    if (broker.position().quantity.gt(0)) exposureBars++;
    totalBars++;
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

  const buyAndHoldReturnPct =
    firstClose === null || lastClose === null
      ? undefined
      : lastClose.minus(firstClose).div(firstClose).times(100);

  return {
    fills,
    equityCurve,
    metrics: calculateBacktestMetrics(
      initialEquity,
      equityCurve.map((point) => point.equity),
      fills.length,
      {
        fromMs: request.fromMs,
        toMs: request.toMs,
        closedTradePnls,
        exposureBars,
        totalBars,
        periodsPerYear: periodsPerYear(request.interval),
        ...(buyAndHoldReturnPct === undefined ? {} : { buyAndHoldReturnPct })
      }
    )
  };
}

function calculateClosedTradePnl(
  fill: Fill,
  quantity: Decimal,
  avgEntry: Decimal
): { readonly pnl: Decimal; readonly quantity: Decimal; readonly avgEntry: Decimal } | undefined {
  if (fill.side === "BUY") return undefined;

  const proceeds = fill.price.times(fill.quantity).minus(fill.fee);
  const pnl = proceeds.minus(avgEntry.times(fill.quantity));
  const nextQuantity = quantity.minus(fill.quantity);

  return {
    pnl,
    quantity: nextQuantity,
    avgEntry: nextQuantity.isZero() ? new DecimalCtor(0) : avgEntry
  };
}

function nextAccountingQuantity(fill: Fill, quantity: Decimal): Decimal {
  return fill.side === "BUY" ? quantity.plus(fill.quantity) : quantity.minus(fill.quantity);
}

function nextAccountingAvgEntry(fill: Fill, nextQuantity: Decimal, avgEntry: Decimal): Decimal {
  if (fill.side !== "BUY") return nextQuantity.isZero() ? new DecimalCtor(0) : avgEntry;

  const previousQuantity = nextQuantity.minus(fill.quantity);
  const costBasis = avgEntry
    .times(previousQuantity)
    .plus(fill.price.times(fill.quantity).plus(fill.fee));
  return costBasis.div(nextQuantity);
}

function periodsPerYear(interval: string): number {
  switch (interval) {
    case "15m":
      return 365.25 * 24 * 4;
    case "1h":
      return 365.25 * 24;
    default:
      return 1;
  }
}
