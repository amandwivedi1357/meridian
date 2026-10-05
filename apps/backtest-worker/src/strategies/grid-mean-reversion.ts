import { Decimal, createSma, type Strategy } from "@meridian/core";

export interface GridMeanReversionOptions {
  readonly symbol: string;
  readonly interval: "15m" | "1h";
  readonly lookbackPeriod: number;
  readonly gridStepPct: Decimal;
  readonly quantity: Decimal;
  readonly maxPosition?: Decimal;
}

export function createGridMeanReversion(options: GridMeanReversionOptions): Strategy {
  validateOptions(options);

  const { symbol, interval, lookbackPeriod, gridStepPct, quantity } = options;
  const maxPosition = options.maxPosition ?? quantity;
  let mean = createSma(lookbackPeriod);

  return {
    id: "grid-mean-reversion",
    onInit() {
      mean = createSma(lookbackPeriod);
    },
    onCandle(candle, ctx) {
      if (!candle.closed || candle.symbol !== symbol || candle.interval !== interval) return;

      const meanPrice = mean.update(candle.close);
      if (meanPrice === null) return;

      const step = gridStepPct.div(100);
      const buyThreshold = meanPrice.times(new Decimal(1).minus(step));
      const sellThreshold = meanPrice.times(new Decimal(1).plus(step));
      const position = ctx.position(symbol).quantity;

      if (candle.close.lte(buyThreshold) && position.lt(maxPosition)) {
        ctx.submit({
          symbol,
          side: "BUY",
          type: "MARKET",
          quantity: Decimal.min(quantity, maxPosition.minus(position)),
          reason: "Grid mean-reversion buy"
        });
      } else if (candle.close.gte(sellThreshold) && position.gt(0)) {
        ctx.submit({
          symbol,
          side: "SELL",
          type: "MARKET",
          quantity: Decimal.min(quantity, position),
          reason: "Grid mean-reversion sell"
        });
      }
    }
  };
}

function validateOptions(options: GridMeanReversionOptions): void {
  if (!Number.isSafeInteger(options.lookbackPeriod) || options.lookbackPeriod < 1) {
    throw new Error("Lookback period must be a positive integer");
  }
  if (!options.gridStepPct.isFinite() || options.gridStepPct.lte(0)) {
    throw new Error("Grid step must be finite and positive");
  }
  if (!options.quantity.isFinite() || options.quantity.lte(0)) {
    throw new Error("Quantity must be finite and positive");
  }
  if (
    options.maxPosition !== undefined &&
    (!options.maxPosition.isFinite() || options.maxPosition.lte(0))
  ) {
    throw new Error("Max position must be finite and positive");
  }
}
