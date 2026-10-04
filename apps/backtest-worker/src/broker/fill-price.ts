import { Decimal, type Side } from "@meridian/core";

export function calculateMarketFillPrice(
  openPrice: Decimal,
  side: Side,
  slippageBps: Decimal
): Decimal {
  if (!openPrice.isFinite() || openPrice.lte(0)) {
    throw new Error("Open price must be finite and positive");
  }

  if (!slippageBps.isFinite() || slippageBps.lt(0) || slippageBps.gte(10_000)) {
    throw new Error("Slippage must be between 0 and 10000 bps");
  }

  const adjustment = slippageBps.div(10_000);
  const multiplier =
    side === "BUY" ? new Decimal(1).plus(adjustment) : new Decimal(1).minus(adjustment);

  return openPrice.times(multiplier);
}
