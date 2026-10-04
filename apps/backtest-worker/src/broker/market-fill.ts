import type { Decimal, Fill, OrderIntent } from "@meridian/core";
import type { SimBrokerOptions } from "./sim-broker.js";
import { calculateMarketFillPrice } from "./fill-price.js";

export function createMarketFill(
  intent: OrderIntent,
  openPrice: Decimal,
  tsMs: number,
  options: Pick<SimBrokerOptions, "symbol" | "quoteAsset" | "slippageBps" | "takerFeeRate">
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

  const price = calculateMarketFillPrice(openPrice, intent.side, options.slippageBps);
  const fee = price.times(intent.quantity).times(options.takerFeeRate);

  return {
    symbol: intent.symbol,
    side: intent.side,
    quantity: intent.quantity,
    price,
    fee,
    feeAsset: options.quoteAsset,
    tsMs
  };
}
