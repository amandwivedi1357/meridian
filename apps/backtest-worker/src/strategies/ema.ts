import { Decimal } from "@meridian/core";

export interface Ema {
  readonly update: (price: Decimal) => Decimal | null;
}

export function createEma(period: number): Ema {
  if (!Number.isSafeInteger(period) || period < 1) {
    throw new Error("EMA period must be a positive integer");
  }

  const multiplier = new Decimal(2).div(new Decimal(period).plus(1));

  let count = 0;
  let sum = new Decimal(0);
  let value: Decimal | null = null;

  return {
    update(price) {
      if (value === null) {
        sum = sum.plus(price);
        count += 1;

        if (count < period) return null;

        value = sum.div(period);
        return value;
      }

      value = price.minus(value).times(multiplier).plus(value);
      return value;
    }
  };
}
