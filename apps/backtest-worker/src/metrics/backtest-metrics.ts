import { Decimal } from "@meridian/core";

export interface BacktestMetrics {
  readonly totalReturnPct: Decimal;
  readonly maxDrawdownPct: Decimal;
  readonly tradeCount: number;
}

export function calculateBacktestMetrics(
  initialEquity: Decimal,
  equityValues: readonly Decimal[],
  tradeCount: number
): BacktestMetrics {
  if (!initialEquity.isFinite() || initialEquity.lte(0)) {
    throw new Error("Initial equity must be finite and positive");
  }
  if (!Number.isSafeInteger(tradeCount) || tradeCount < 0) {
    throw new Error("Trade count must be a non-negative integer");
  }

  let peak = initialEquity;
  let endingEquity = initialEquity;
  let maxDrawdown = new Decimal(0);

  for (const equity of equityValues) {
    if (!equity.isFinite() || equity.lt(0)) {
      throw new Error("Equity must be finite and non-negative");
    }

    peak = Decimal.max(peak, equity);
    const drawdown = peak.minus(equity).div(peak);
    maxDrawdown = Decimal.max(maxDrawdown, drawdown);
    endingEquity = equity;
  }

  return {
    totalReturnPct: endingEquity.minus(initialEquity).div(initialEquity).times(100),
    maxDrawdownPct: maxDrawdown.times(100),
    tradeCount
  };
}
