import { Decimal, type Strategy } from "@meridian/core";
import { createEma } from "./ema.js";

export function createEmaCrossover(options: {
  symbol: string;
  interval: "15m" | "1h";
  fastPeriod: number;
  slowPeriod: number;
  quantity: Decimal;
}): Strategy {
  const { symbol, interval, fastPeriod, slowPeriod, quantity } = options;

  if (fastPeriod >= slowPeriod) {
    throw new Error("Fast period must be smaller than slow period");
  }
  if (!quantity.isFinite() || quantity.lte(0)) {
    throw new Error("Quantity must be finite and positive");
  }

  let fast = createEma(fastPeriod);
  let slow = createEma(slowPeriod);
  let previousDifference: Decimal | null = null;

  return {
    id: "ema-crossover",
    onInit() {
      fast = createEma(fastPeriod);
      slow = createEma(slowPeriod);
      previousDifference = null;
    },
    onCandle(candle, ctx) {
      if (!candle.closed || candle.symbol !== symbol || candle.interval !== interval) return;

      const fastValue = fast.update(candle.close);
      const slowValue = slow.update(candle.close);
      if (fastValue === null || slowValue === null) return;

      const difference = fastValue.minus(slowValue);
      const position = ctx.position(symbol).quantity;

      if (previousDifference !== null) {
        if (previousDifference.lte(0) && difference.gt(0) && position.isZero()) {
          ctx.submit({
            symbol,
            side: "BUY",
            type: "MARKET",
            quantity,
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
