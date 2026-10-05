import { Decimal } from "@meridian/core";

export interface BacktestMetrics {
  readonly totalReturnPct: Decimal;
  readonly cagrPct: Decimal;
  readonly maxDrawdownPct: Decimal;
  readonly sharpeRatio: Decimal;
  readonly sortinoRatio: Decimal;
  readonly winRatePct: Decimal;
  readonly profitFactor: Decimal;
  readonly exposurePct: Decimal;
  readonly tradeCount: number;
  readonly buyAndHoldReturnPct: Decimal;
  readonly strategyVsBuyAndHoldPct: Decimal;
}

export interface BacktestMetricOptions {
  readonly fromMs?: number;
  readonly toMs?: number;
  readonly periodsPerYear?: number;
  readonly closedTradePnls?: readonly Decimal[];
  readonly exposureBars?: number;
  readonly totalBars?: number;
  readonly buyAndHoldReturnPct?: Decimal;
}

export function calculateBacktestMetrics(
  initialEquity: Decimal,
  equityValues: readonly Decimal[],
  tradeCount: number,
  options: BacktestMetricOptions = {}
): BacktestMetrics {
  if (!initialEquity.isFinite() || initialEquity.lte(0)) {
    throw new Error("Initial equity must be finite and positive");
  }
  if (!Number.isSafeInteger(tradeCount) || tradeCount < 0) {
    throw new Error("Trade count must be a non-negative integer");
  }
  if (
    options.buyAndHoldReturnPct !== undefined &&
    !options.buyAndHoldReturnPct.isFinite()
  ) {
    throw new Error("Buy-and-hold return must be finite");
  }

  let peak = initialEquity;
  let endingEquity = initialEquity;
  let maxDrawdown = new Decimal(0);
  let previousEquity = initialEquity;
  const periodReturns: Decimal[] = [];

  for (const equity of equityValues) {
    if (!equity.isFinite() || equity.lt(0)) {
      throw new Error("Equity must be finite and non-negative");
    }

    if (!previousEquity.isZero()) {
      periodReturns.push(equity.minus(previousEquity).div(previousEquity));
    }
    previousEquity = equity;
    peak = Decimal.max(peak, equity);
    const drawdown = peak.minus(equity).div(peak);
    maxDrawdown = Decimal.max(maxDrawdown, drawdown);
    endingEquity = equity;
  }

  const totalReturnPct = endingEquity.minus(initialEquity).div(initialEquity).times(100);
  const buyAndHoldReturnPct = options.buyAndHoldReturnPct ?? new Decimal(0);
  return {
    totalReturnPct,
    cagrPct: calculateCagrPct(initialEquity, endingEquity, options),
    maxDrawdownPct: maxDrawdown.times(100),
    sharpeRatio: calculateSharpeRatio(periodReturns, options.periodsPerYear ?? 1),
    sortinoRatio: calculateSortinoRatio(periodReturns, options.periodsPerYear ?? 1),
    winRatePct: calculateWinRatePct(options.closedTradePnls ?? []),
    profitFactor: calculateProfitFactor(options.closedTradePnls ?? []),
    exposurePct: calculateExposurePct(options.exposureBars ?? 0, options.totalBars ?? 0),
    tradeCount,
    buyAndHoldReturnPct,
    strategyVsBuyAndHoldPct: totalReturnPct.minus(buyAndHoldReturnPct)
  };
}

function calculateCagrPct(
  initialEquity: Decimal,
  endingEquity: Decimal,
  options: BacktestMetricOptions
): Decimal {
  if (options.fromMs === undefined && options.toMs === undefined) {
    return endingEquity.minus(initialEquity).div(initialEquity).times(100);
  }
  if (
    options.fromMs === undefined ||
    options.toMs === undefined ||
    !Number.isSafeInteger(options.fromMs) ||
    !Number.isSafeInteger(options.toMs) ||
    options.fromMs >= options.toMs
  ) {
    throw new Error("Metric time range must be increasing");
  }

  const years = new Decimal(options.toMs - options.fromMs).div(365.25 * 24 * 60 * 60 * 1000);
  if (endingEquity.isZero()) return new Decimal(-100);

  return endingEquity.div(initialEquity).pow(new Decimal(1).div(years)).minus(1).times(100);
}

function calculateSharpeRatio(returns: readonly Decimal[], periodsPerYear: number): Decimal {
  if (returns.length < 2) return new Decimal(0);
  validatePeriodsPerYear(periodsPerYear);

  const mean = average(returns);
  const variance = average(returns.map((value) => value.minus(mean).pow(2)));
  if (variance.isZero()) return new Decimal(0);

  return mean.div(variance.sqrt()).times(new Decimal(periodsPerYear).sqrt());
}

function calculateSortinoRatio(returns: readonly Decimal[], periodsPerYear: number): Decimal {
  if (returns.length === 0) return new Decimal(0);
  validatePeriodsPerYear(periodsPerYear);

  const mean = average(returns);
  const downside = returns.filter((value) => value.lt(0));
  if (downside.length === 0) return new Decimal(0);

  const downsideDeviation = average(downside.map((value) => value.pow(2))).sqrt();
  if (downsideDeviation.isZero()) return new Decimal(0);

  return mean.div(downsideDeviation).times(new Decimal(periodsPerYear).sqrt());
}

function calculateWinRatePct(closedTradePnls: readonly Decimal[]): Decimal {
  validateClosedTradePnls(closedTradePnls);
  if (closedTradePnls.length === 0) return new Decimal(0);

  const wins = closedTradePnls.filter((pnl) => pnl.gt(0)).length;
  return new Decimal(wins).div(closedTradePnls.length).times(100);
}

function calculateProfitFactor(closedTradePnls: readonly Decimal[]): Decimal {
  validateClosedTradePnls(closedTradePnls);
  const grossProfit = closedTradePnls
    .filter((pnl) => pnl.gt(0))
    .reduce((sum, pnl) => sum.plus(pnl), new Decimal(0));
  const grossLoss = closedTradePnls
    .filter((pnl) => pnl.lt(0))
    .reduce((sum, pnl) => sum.plus(pnl.abs()), new Decimal(0));

  if (grossProfit.isZero() && grossLoss.isZero()) return new Decimal(0);
  if (grossLoss.isZero()) return grossProfit;
  return grossProfit.div(grossLoss);
}

function calculateExposurePct(exposureBars: number, totalBars: number): Decimal {
  if (!Number.isSafeInteger(totalBars) || totalBars < 0) {
    throw new Error("Total bars must be a non-negative integer");
  }
  if (
    !Number.isSafeInteger(exposureBars) ||
    exposureBars < 0 ||
    exposureBars > totalBars
  ) {
    throw new Error("Exposure bars must be between 0 and total bars");
  }
  if (totalBars === 0) return new Decimal(0);
  return new Decimal(exposureBars).div(totalBars).times(100);
}

function validateClosedTradePnls(closedTradePnls: readonly Decimal[]): void {
  for (const pnl of closedTradePnls) {
    if (!pnl.isFinite()) {
      throw new Error("Closed trade PnL must be finite");
    }
  }
}

function validatePeriodsPerYear(periodsPerYear: number): void {
  if (!Number.isFinite(periodsPerYear) || periodsPerYear <= 0) {
    throw new Error("Periods per year must be finite and positive");
  }
}

function average(values: readonly Decimal[]): Decimal {
  return values.reduce((sum, value) => sum.plus(value), new Decimal(0)).div(values.length);
}
