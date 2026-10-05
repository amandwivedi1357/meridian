import { Decimal } from "decimal.js";

export type DecimalInput = Decimal.Value;

export interface ExchangeFilters {
  readonly tickSize: Decimal;
  readonly stepSize: Decimal;
  readonly minNotional: Decimal;
}

export interface OrderFilterInput {
  readonly price: Decimal;
  readonly quantity: Decimal;
}

export interface OrderFilterResult {
  readonly price: Decimal;
  readonly quantity: Decimal;
  readonly notional: Decimal;
  readonly meetsMinNotional: boolean;
}

export function decimal(value: DecimalInput): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

export function assertPositiveDecimal(value: Decimal, name: string): void {
  if (!value.isFinite() || value.lte(0)) {
    throw new Error(`${name} must be a positive finite decimal`);
  }
}

export function roundDownToIncrement(value: Decimal, increment: Decimal): Decimal {
  assertPositiveDecimal(increment, "increment");

  if (!value.isFinite() || value.lt(0)) {
    throw new Error("value must be a non-negative finite decimal");
  }

  return value.div(increment).floor().mul(increment);
}

export function roundUpToIncrement(value: Decimal, increment: Decimal): Decimal {
  assertPositiveDecimal(increment, "increment");

  if (!value.isFinite() || value.lt(0)) {
    throw new Error("value must be a non-negative finite decimal");
  }

  return value.div(increment).ceil().mul(increment);
}

export function isMultipleOfIncrement(value: Decimal, increment: Decimal): boolean {
  assertPositiveDecimal(increment, "increment");

  if (!value.isFinite() || value.lt(0)) {
    return false;
  }

  return value.mod(increment).isZero();
}

export function normalizeLimitPrice(
  price: Decimal,
  side: "BUY" | "SELL",
  filters: ExchangeFilters
): Decimal {
  return side === "BUY"
    ? roundDownToIncrement(price, filters.tickSize)
    : roundUpToIncrement(price, filters.tickSize);
}

export function normalizeQuantity(quantity: Decimal, filters: ExchangeFilters): Decimal {
  return roundDownToIncrement(quantity, filters.stepSize);
}

export function calculateNotional(price: Decimal, quantity: Decimal): Decimal {
  return price.mul(quantity);
}

export function applyExchangeFilters(
  input: OrderFilterInput,
  filters: ExchangeFilters
): OrderFilterResult {
  const price = roundDownToIncrement(input.price, filters.tickSize);
  const quantity = normalizeQuantity(input.quantity, filters);
  const notional = calculateNotional(price, quantity);

  return {
    price,
    quantity,
    notional,
    meetsMinNotional: notional.gte(filters.minNotional)
  };
}

export function validateExchangeFilters(filters: ExchangeFilters): void {
  assertPositiveDecimal(filters.tickSize, "tickSize");
  assertPositiveDecimal(filters.stepSize, "stepSize");
  assertPositiveDecimal(filters.minNotional, "minNotional");
}
