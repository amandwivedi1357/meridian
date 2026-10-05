import {
  calculateNotional,
  normalizeQuantity,
  roundDownToIncrement,
  roundUpToIncrement,
  type Decimal,
  type Fill,
  type OrderIntent
} from "@meridian/core";
import type { SimBrokerOptions } from "./sim-broker.js";
import { calculateMarketFillPrice } from "./fill-price.js";

export function createMarketFill(
  intent: OrderIntent,
  openPrice: Decimal,
  tsMs: number,
  options: Pick<
    SimBrokerOptions,
    "symbol" | "quoteAsset" | "slippageBps" | "takerFeeRate" | "exchangeFilters"
  >
): Fill {
  if (intent.symbol !== options.symbol || intent.type !== "MARKET") {
    throw new Error("Unsupported simulated order");
  }
  if (!intent.quantity.isFinite() || intent.quantity.lte(0)) {
    throw new Error("Quantity must be finite and positive");
  }
  if (
    !options.takerFeeRate.isFinite() ||
    options.takerFeeRate.lt(0) ||
    options.takerFeeRate.gte(1)
  ) {
    throw new Error("Fee rate must be between 0 and 1");
  }
  if (!Number.isSafeInteger(tsMs) || tsMs < 0) {
    throw new Error("Invalid fill timestamp");
  }

  const rawPrice = calculateMarketFillPrice(openPrice, intent.side, options.slippageBps);
  const filters = options.exchangeFilters;

  const price =
    filters === undefined
      ? rawPrice
      : intent.side === "BUY"
        ? roundUpToIncrement(rawPrice, filters.tickSize)
        : roundDownToIncrement(rawPrice, filters.tickSize);

  const quantity =
    filters === undefined ? intent.quantity : normalizeQuantity(intent.quantity, filters);

  if (quantity.lte(0)) {
    throw new Error("Quantity is below exchange step size");
  }

  if (filters !== undefined && calculateNotional(price, quantity).lt(filters.minNotional)) {
    throw new Error("Order notional is below exchange minimum");
  }

  const fee = price.times(quantity).times(options.takerFeeRate);

  return {
    symbol: intent.symbol,
    side: intent.side,
    quantity,
    price,
    fee,
    feeAsset: options.quoteAsset,
    tsMs
  };
}
