import { Decimal } from "decimal.js";

export interface Indicator<TInput = Decimal> {
  readonly update: (value: TInput) => Decimal | null;
}

export interface AtrInput {
  readonly high: Decimal;
  readonly low: Decimal;
  readonly close: Decimal;
}

export interface BollingerBands {
  readonly middle: Decimal;
  readonly upper: Decimal;
  readonly lower: Decimal;
}

export interface BollingerBandsIndicator {
  readonly update: (value: Decimal) => BollingerBands | null;
}

function assertValidPeriod(period: number): void {
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error("indicator period must be a positive integer");
  }
}

export function createSma(period: number): Indicator {
  assertValidPeriod(period);

  const values: Decimal[] = [];
  let sum = new Decimal(0);

  return {
    update(value) {
      values.push(value);
      sum = sum.plus(value);

      if (values.length > period) {
        const removed = values.shift();
        if (removed !== undefined) {
          sum = sum.minus(removed);
        }
      }

      if (values.length < period) {
        return null;
      }

      return sum.div(period);
    }
  };
}

export function createEma(period: number): Indicator {
  assertValidPeriod(period);

  const multiplier = new Decimal(2).div(new Decimal(period).plus(1));
  const warmup: Decimal[] = [];
  let value: Decimal | null = null;

  return {
    update(price) {
      if (value !== null) {
        value = price.minus(value).mul(multiplier).plus(value);
        return value;
      }

      warmup.push(price);

      if (warmup.length < period) {
        return null;
      }

      const sum = warmup.reduce((total, current) => total.plus(current), new Decimal(0));
      value = sum.div(period);
      return value;
    }
  };
}

export function createRsi(period: number): Indicator {
  assertValidPeriod(period);

  let previous: Decimal | null = null;
  const gains: Decimal[] = [];
  const losses: Decimal[] = [];
  let averageGain: Decimal | null = null;
  let averageLoss: Decimal | null = null;

  return {
    update(price) {
      if (previous === null) {
        previous = price;
        return null;
      }

      const change = price.minus(previous);
      previous = price;

      const gain = Decimal.max(change, 0);
      const loss = Decimal.max(change.negated(), 0);

      if (averageGain !== null && averageLoss !== null) {
        averageGain = averageGain.mul(period - 1).plus(gain).div(period);
        averageLoss = averageLoss.mul(period - 1).plus(loss).div(period);

        if (averageLoss.isZero()) {
          return new Decimal(100);
        }

        const relativeStrength = averageGain.div(averageLoss);
        return new Decimal(100).minus(new Decimal(100).div(relativeStrength.plus(1)));
      }

      gains.push(gain);
      losses.push(loss);

      if (gains.length < period) {
        return null;
      }

      averageGain = gains.reduce((total, current) => total.plus(current), new Decimal(0)).div(period);
      averageLoss = losses.reduce((total, current) => total.plus(current), new Decimal(0)).div(period);

      if (averageLoss.isZero()) {
        return new Decimal(100);
      }

      const relativeStrength = averageGain.div(averageLoss);
      return new Decimal(100).minus(new Decimal(100).div(relativeStrength.plus(1)));
    }
  };
}

export function createAtr(period: number): Indicator<AtrInput> {
  assertValidPeriod(period);

  let previousClose: Decimal | null = null;
  const trueRanges: Decimal[] = [];
  let value: Decimal | null = null;

  return {
    update(input) {
      const candle = input as unknown as AtrInput;

      const highLow = candle.high.minus(candle.low);
      const highPreviousClose =
        previousClose === null ? highLow : candle.high.minus(previousClose).abs();
      const lowPreviousClose =
        previousClose === null ? highLow : candle.low.minus(previousClose).abs();

      const trueRange = Decimal.max(highLow, highPreviousClose, lowPreviousClose);
      previousClose = candle.close;

      if (value !== null) {
        value = value.mul(period - 1).plus(trueRange).div(period);
        return value;
      }

      trueRanges.push(trueRange);

      if (trueRanges.length < period) {
        return null;
      }

      const sum = trueRanges.reduce((total, current) => total.plus(current), new Decimal(0));
      value = sum.div(period);
      return value;
    }
  };
}

export function createBollingerBands(
  period: number,
  standardDeviationMultiplier = new Decimal(2)
): BollingerBandsIndicator {
  assertValidPeriod(period);

  if (!standardDeviationMultiplier.isFinite() || standardDeviationMultiplier.lte(0)) {
    throw new Error("standard deviation multiplier must be a positive finite decimal");
  }

  const values: Decimal[] = [];

  return {
    update(value) {
      values.push(value);

      if (values.length > period) {
        values.shift();
      }

      if (values.length < period) {
        return null;
      }

      const middle = values.reduce((total, current) => total.plus(current), new Decimal(0)).div(period);

      const variance = values
        .reduce((total, current) => {
          const difference = current.minus(middle);
          return total.plus(difference.pow(2));
        }, new Decimal(0))
        .div(period);

      const standardDeviation = variance.sqrt();
      const bandDistance = standardDeviation.mul(standardDeviationMultiplier);

      return {
        middle,
        upper: middle.plus(bandDistance),
        lower: middle.minus(bandDistance)
      };
    }
  };
}