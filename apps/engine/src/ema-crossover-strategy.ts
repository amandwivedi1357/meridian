import { Decimal, createEma, type Strategy } from "@meridian/core";

export interface EmaCrossoverStrategyOptions {
  readonly symbol: string;
  readonly interval: "1m" | "5m" | "15m" | "1h";
  readonly fastPeriod: number;
  readonly slowPeriod: number;
  readonly quantity: Decimal;
}

export function createEngineEmaCrossoverStrategy(
  options: EmaCrossoverStrategyOptions
): Strategy {
  validateOptions(options);

  let fast = createEma(options.fastPeriod);
  let slow = createEma(options.slowPeriod);
  let previousDifference: Decimal | null = null;

  return {
    id: "ema-crossover",

    onInit() {
      fast = createEma(options.fastPeriod);
      slow = createEma(options.slowPeriod);
      previousDifference = null;
    },

    onCandle(candle, ctx) {
      if (
        !candle.closed ||
        candle.symbol !== options.symbol ||
        candle.interval !== options.interval
      ) {
        return;
      }

      const fastValue = fast.update(candle.close);
      const slowValue = slow.update(candle.close);
      if (fastValue === null || slowValue === null) return;

      const difference = fastValue.minus(slowValue);
      const position = ctx.position(options.symbol).quantity;

      if (previousDifference !== null) {
        if (previousDifference.lte(0) && difference.gt(0) && position.isZero()) {
          ctx.submit({
            symbol: options.symbol,
            side: "BUY",
            type: "MARKET",
            quantity: options.quantity,
            reason: "EMA bullish crossover"
          });
        } else if (previousDifference.gte(0) && difference.lt(0) && position.gt(0)) {
          ctx.submit({
            symbol: options.symbol,
            side: "SELL",
            type: "MARKET",
            quantity: Decimal.min(position, options.quantity),
            reason: "EMA bearish crossover"
          });
        }
      }

      previousDifference = difference;
    }
  };
}

function validateOptions(options: EmaCrossoverStrategyOptions): void {
  if (options.fastPeriod >= options.slowPeriod) {
    throw new Error("Fast period must be smaller than slow period");
  }

  if (!options.quantity.isFinite() || options.quantity.lte(0)) {
    throw new Error("Quantity must be finite and positive");
  }
}
