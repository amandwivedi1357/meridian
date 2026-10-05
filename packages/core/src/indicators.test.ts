import { describe, expect, it } from "vitest";
import {
  Decimal,
  createAtr,
  createBollingerBands,
  createEma,
  createRsi,
  createSma,
  type AtrInput
} from "./index.js";

function updateAll(indicator: ReturnType<typeof createSma>, values: readonly string[]) {
  return values.map((value) => indicator.update(new Decimal(value))?.toString() ?? null);
}

function atrInput(high: string, low: string, close: string): AtrInput {
  return {
    high: new Decimal(high),
    low: new Decimal(low),
    close: new Decimal(close)
  };
}

describe("indicators", () => {
  describe("createSma", () => {
    it("returns null until the warm-up window is full", () => {
      const sma = createSma(3);

      expect(updateAll(sma, ["10", "20"])).toEqual([null, null]);
      expect(sma.update(new Decimal("30"))?.toString()).toBe("20");
    });

    it("keeps a rolling average after warm-up", () => {
      const sma = createSma(3);

      expect(updateAll(sma, ["10", "20", "30", "40", "50"])).toEqual([
        null,
        null,
        "20",
        "30",
        "40"
      ]);
    });

    it("preserves decimal precision", () => {
      const sma = createSma(3);

      expect(updateAll(sma, ["0.1", "0.2", "0.3"])).toEqual([null, null, "0.2"]);
    });
  });

  describe("createEma", () => {
    it("uses the SMA of the warm-up window as the first EMA value", () => {
      const ema = createEma(3);

      expect(updateAll(ema, ["10", "20", "30"])).toEqual([null, null, "20"]);
    });

    it("updates EMA values with the standard multiplier", () => {
      const ema = createEma(3);

      expect(updateAll(ema, ["10", "20", "30", "40", "20"])).toEqual([
        null,
        null,
        "20",
        "30",
        "25"
      ]);
    });

    it("keeps separate state for independent indicators", () => {
      const first = createEma(2);
      const second = createEma(2);

      expect(first.update(new Decimal("10"))).toBeNull();
      expect(second.update(new Decimal("100"))).toBeNull();
      expect(first.update(new Decimal("20"))?.toString()).toBe("15");
      expect(second.update(new Decimal("200"))?.toString()).toBe("150");
    });
  });

  describe("createRsi", () => {
    it("returns null until it has enough price changes", () => {
      const rsi = createRsi(3);

      expect(updateAll(rsi, ["10", "11", "12"])).toEqual([null, null, null]);
      expect(rsi.update(new Decimal("13"))?.toString()).toBe("100");
    });

    it("calculates the first RSI from average gains and losses", () => {
      const rsi = createRsi(3);

      expect(updateAll(rsi, ["10", "12", "11", "13"])).toEqual([
        null,
        null,
        null,
        "80"
      ]);
    });

    it("uses Wilder smoothing after the first RSI value", () => {
      const rsi = createRsi(3);

      const values = updateAll(rsi, ["10", "12", "11", "13", "12"]);

      expect(values.slice(0, 4)).toEqual([null, null, null, "80"]);
      expect(new Decimal(values[4] ?? 0).toFixed(12)).toBe("61.538461538462");
    });

    it("returns 100 when there are no average losses", () => {
      const rsi = createRsi(3);

      expect(updateAll(rsi, ["10", "11", "12", "13", "14"])).toEqual([
        null,
        null,
        null,
        "100",
        "100"
      ]);
    });

    it("returns 0 when there are no average gains", () => {
      const rsi = createRsi(3);

      expect(updateAll(rsi, ["14", "13", "12", "11"])).toEqual([
        null,
        null,
        null,
        "0"
      ]);
    });
  });

  describe("createAtr", () => {
    it("returns null until it has enough true ranges", () => {
      const atr = createAtr(3);

      expect(atr.update(atrInput("12", "10", "11"))).toBeNull();
      expect(atr.update(atrInput("13", "11", "12"))).toBeNull();
      expect(atr.update(atrInput("14", "12", "13"))?.toString()).toBe("2");
    });

    it("uses previous close gaps when calculating true range", () => {
      const atr = createAtr(2);

      expect(atr.update(atrInput("10", "9", "9.5"))).toBeNull();
      expect(atr.update(atrInput("12", "11", "11.5"))?.toString()).toBe("1.75");
    });

    it("uses Wilder smoothing after the first ATR value", () => {
      const atr = createAtr(3);

      atr.update(atrInput("12", "10", "11"));
      atr.update(atrInput("13", "11", "12"));
      expect(atr.update(atrInput("14", "12", "13"))?.toString()).toBe("2");
      expect(atr.update(atrInput("17", "15", "16"))?.toString()).toBe(
        "2.6666666666666666667"
      );
    });

    it("preserves decimal precision", () => {
      const atr = createAtr(2);

      expect(atr.update(atrInput("1.2", "1.1", "1.15"))).toBeNull();
      expect(atr.update(atrInput("1.25", "1.05", "1.2"))?.toString()).toBe("0.15");
    });
  });

  describe("createBollingerBands", () => {
    it("returns null until the warm-up window is full", () => {
      const bands = createBollingerBands(3);

      expect(bands.update(new Decimal("10"))).toBeNull();
      expect(bands.update(new Decimal("20"))).toBeNull();

      const result = bands.update(new Decimal("30"));

      expect(result?.middle.toString()).toBe("20");
      expect(result?.upper.toFixed(12)).toBe("36.329931618555");
      expect(result?.lower.toFixed(12)).toBe("3.670068381445");
    });

    it("uses the latest rolling window", () => {
      const bands = createBollingerBands(3);

      bands.update(new Decimal("10"));
      bands.update(new Decimal("20"));
      bands.update(new Decimal("30"));
      const result = bands.update(new Decimal("40"));

      expect(result?.middle.toString()).toBe("30");
      expect(result?.upper.toFixed(12)).toBe("46.329931618555");
      expect(result?.lower.toFixed(12)).toBe("13.670068381445");
    });

    it("supports a custom standard deviation multiplier", () => {
      const bands = createBollingerBands(3, new Decimal("1"));

      bands.update(new Decimal("10"));
      bands.update(new Decimal("20"));
      const result = bands.update(new Decimal("30"));

      expect(result?.middle.toString()).toBe("20");
      expect(result?.upper.toFixed(12)).toBe("28.164965809277");
      expect(result?.lower.toFixed(12)).toBe("11.835034190723");
    });

    it("rejects invalid standard deviation multipliers", () => {
      expect(() => createBollingerBands(3, new Decimal(0))).toThrow(
        "standard deviation multiplier must be a positive finite decimal"
      );
      expect(() => createBollingerBands(3, new Decimal("NaN"))).toThrow(
        "standard deviation multiplier must be a positive finite decimal"
      );
    });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid period %s",
    (period) => {
      expect(() => createSma(period)).toThrow("indicator period must be a positive integer");
      expect(() => createEma(period)).toThrow("indicator period must be a positive integer");
      expect(() => createRsi(period)).toThrow("indicator period must be a positive integer");
      expect(() => createAtr(period)).toThrow("indicator period must be a positive integer");
      expect(() => createBollingerBands(period)).toThrow(
        "indicator period must be a positive integer"
      );
    }
  );
});
