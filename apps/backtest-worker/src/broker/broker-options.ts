import { Decimal } from "@meridian/core";
import type { SimBrokerOptions } from "./sim-broker.js";
import { calculateMarketFillPrice } from "./fill-price.js";

export function validateSimBrokerOptions(options: SimBrokerOptions): void {
  if (
    !options.baseAsset.trim() ||
    !options.quoteAsset.trim() ||
    options.baseAsset === options.quoteAsset ||
    options.symbol !== options.baseAsset + options.quoteAsset
  ) {
    throw new Error("Invalid broker asset configuration");
  }

  if (!options.initialQuoteBalance.isFinite() || options.initialQuoteBalance.lte(0)) {
    throw new Error("Initial quote balance must be finite and positive");
  }

  if (
    !options.takerFeeRate.isFinite() ||
    options.takerFeeRate.lt(0) ||
    options.takerFeeRate.gte(1)
  ) {
    throw new Error("Fee rate must be between 0 and 1");
  }

  calculateMarketFillPrice(new Decimal(1), "BUY", options.slippageBps);
}
