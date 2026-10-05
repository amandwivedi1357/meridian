import { Decimal, createAtr, type Strategy } from "@meridian/core";
import { createEma } from "./ema.js";

interface AtrSizingOptions {
  readonly atrPeriod: number;
  readonly riskFraction: Decimal;
  readonly stopAtrMultiple: Decimal;
  readonly maxQuantity?: Decimal;
}

export function createEmaCrossover(options: {
  symbol: string;
  interval: "15m" | "1h";
  fastPeriod: number;
  slowPeriod: number;
  atrSizing?: AtrSizingOptions;
  quantity: Decimal;
}): Strategy {
  const { symbol, interval, fastPeriod, slowPeriod, quantity } = options;

  if (fastPeriod >= slowPeriod) {
    throw new Error("Fast period must be smaller than slow period");
  }
  if (!quantity.isFinite() || quantity.lte(0)) {
    throw new Error("Quantity must be finite and positive");
  }

  if (options.atrSizing !== undefined) {
    validateAtrSizing(options.atrSizing);
  }

  let atr = options.atrSizing === undefined ? null : createAtr(options.atrSizing.atrPeriod);
  let fast = createEma(fastPeriod);
  let slow = createEma(slowPeriod);
  let previousDifference: Decimal | null = null;

  return {
    id: "ema-crossover",
    onInit() {
      fast = createEma(fastPeriod);
      slow = createEma(slowPeriod);
      atr = options.atrSizing === undefined ? null : createAtr(options.atrSizing.atrPeriod);
      previousDifference = null;
    },
    onCandle(candle, ctx) {
      if (!candle.closed || candle.symbol !== symbol || candle.interval !== interval) return;

      const atrValue =
        atr?.update({
          high: candle.high,
          low: candle.low,
          close: candle.close
        }) ?? null;
      const fastValue = fast.update(candle.close);
      const slowValue = slow.update(candle.close);
      if (fastValue === null || slowValue === null) return;

      const difference = fastValue.minus(slowValue);
      const position = ctx.position(symbol).quantity;

      if (previousDifference !== null) {
        if (previousDifference.lte(0) && difference.gt(0) && position.isZero()) {
          const entryQuantity = resolveEntryQuantity(
            quantity,
            options.atrSizing,
            atrValue,
            ctx.balance("USDT")
          );
          ctx.submit({
            symbol,
            side: "BUY",
            type: "MARKET",
            quantity: entryQuantity,
            reason: "EMA bullish crossover"
          });
        } else if (previousDifference.gte(0) && difference.lt(0) && position.gt(0)) {
          ctx.submit({
            symbol,
            side: "SELL",
            type: "MARKET",
            quantity: Decimal.min(position, quantity),
            reason: "EMA bearish crossover"
          });
        }
      }

      previousDifference = difference;
    }
  };
}

function validateAtrSizing(options: AtrSizingOptions): void {
  if (!Number.isSafeInteger(options.atrPeriod) || options.atrPeriod < 1) {
    throw new Error("ATR period must be a positive integer");
  }
  if (
    !options.riskFraction.isFinite() ||
    options.riskFraction.lte(0) ||
    options.riskFraction.gte(1)
  ) {
    throw new Error("ATR risk fraction must be between 0 and 1");
  }
  if (!options.stopAtrMultiple.isFinite() || options.stopAtrMultiple.lte(0)) {
    throw new Error("ATR stop multiple must be finite and positive");
  }
  if (
    options.maxQuantity !== undefined &&
    (!options.maxQuantity.isFinite() || options.maxQuantity.lte(0))
  ) {
    throw new Error("ATR max quantity must be finite and positive");
  }
}

function resolveEntryQuantity(
  fixedQuantity: Decimal,
  atrSizing: AtrSizingOptions | undefined,
  atrValue: Decimal | null,
  quoteBalance: Decimal
): Decimal {
  if (atrSizing === undefined || atrValue === null || atrValue.lte(0)) {
    return fixedQuantity;
  }

  const riskAmount = quoteBalance.times(atrSizing.riskFraction);
  const stopDistance = atrValue.times(atrSizing.stopAtrMultiple);
  const sizedQuantity = riskAmount.div(stopDistance);

  return atrSizing.maxQuantity === undefined
    ? sizedQuantity
    : Decimal.min(sizedQuantity, atrSizing.maxQuantity);
}
