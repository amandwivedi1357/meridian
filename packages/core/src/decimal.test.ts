import { describe, expect, it } from "vitest";
import {
  Decimal,
  applyExchangeFilters,
  assertPositiveDecimal,
  calculateNotional,
  decimal,
  isMultipleOfIncrement,
  normalizeLimitPrice,
  normalizeQuantity,
  roundDownToIncrement,
  roundUpToIncrement,
  validateExchangeFilters,
  type ExchangeFilters
} from "./index.js";

function filters(): ExchangeFilters {
  return {
    tickSize: new Decimal("0.01"),
    stepSize: new Decimal("0.0001"),
    minNotional: new Decimal("10")
  };
}

describe("decimal helpers", () => {
  it("creates Decimal values without binary floating point drift", () => {
    expect(decimal("0.1").plus(decimal("0.2")).toString()).toBe("0.3");
  });

  it("rounds values down to exchange increments", () => {
    expect(roundDownToIncrement(new Decimal("100.019"), new Decimal("0.01")).toString()).toBe(
      "100.01"
    );
    expect(roundDownToIncrement(new Decimal("0.001234"), new Decimal("0.0001")).toString()).toBe(
      "0.0012"
    );
  });

  it("rounds values up to exchange increments", () => {
    expect(roundUpToIncrement(new Decimal("100.011"), new Decimal("0.01")).toString()).toBe(
      "100.02"
    );
    expect(roundUpToIncrement(new Decimal("100.01"), new Decimal("0.01")).toString()).toBe(
      "100.01"
    );
  });

  it("detects exact increment multiples", () => {
    expect(isMultipleOfIncrement(new Decimal("0.0012"), new Decimal("0.0001"))).toBe(true);
    expect(isMultipleOfIncrement(new Decimal("0.00125"), new Decimal("0.0001"))).toBe(false);
    expect(isMultipleOfIncrement(new Decimal("-0.0012"), new Decimal("0.0001"))).toBe(false);
  });

  it("normalizes buy prices down and sell prices up to avoid crossing exchange ticks", () => {
    expect(normalizeLimitPrice(new Decimal("100.019"), "BUY", filters()).toString()).toBe(
      "100.01"
    );
    expect(normalizeLimitPrice(new Decimal("100.011"), "SELL", filters()).toString()).toBe(
      "100.02"
    );
  });

  it("normalizes quantities down to step size", () => {
    expect(normalizeQuantity(new Decimal("0.123456"), filters()).toString()).toBe("0.1234");
  });

  it("calculates notional exactly", () => {
    expect(calculateNotional(new Decimal("85855.27"), new Decimal("0.00012")).toString()).toBe(
      "10.3026324"
    );
  });

  it("applies filters and reports whether min notional is satisfied", () => {
    const accepted = applyExchangeFilters(
      {
        price: new Decimal("85855.279"),
        quantity: new Decimal("0.00012345")
      },
      filters()
    );

    expect(accepted.price.toString()).toBe("85855.27");
    expect(accepted.quantity.toString()).toBe("0.0001");
    expect(accepted.notional.toString()).toBe("8.585527");
    expect(accepted.meetsMinNotional).toBe(false);

    const larger = applyExchangeFilters(
      {
        price: new Decimal("85855.279"),
        quantity: new Decimal("0.0002")
      },
      filters()
    );

    expect(larger.notional.toString()).toBe("17.171054");
    expect(larger.meetsMinNotional).toBe(true);
  });

  it("rejects non-positive or non-finite increments and filters", () => {
    expect(() => assertPositiveDecimal(new Decimal(0), "tickSize")).toThrow(
      "tickSize must be a positive finite decimal"
    );
    expect(() =>
      roundDownToIncrement(new Decimal("1"), new Decimal("0"))
    ).toThrow("increment must be a positive finite decimal");
    expect(() =>
      validateExchangeFilters({
        ...filters(),
        minNotional: new Decimal("NaN")
      })
    ).toThrow("minNotional must be a positive finite decimal");
  });
});
