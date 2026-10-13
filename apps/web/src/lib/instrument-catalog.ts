import type { MarketInstrument, MarketInstrumentsResponse } from "./api-client.js";

export function instrumentCatalog(value: MarketInstrumentsResponse): readonly MarketInstrument[] {
  if (
    !Array.isArray(value.instruments) ||
    !value.instruments.length ||
    value.instruments.length > 500
  )
    throw new Error("invalid_instrument_catalog");
  const symbols = new Set<string>();
  for (const item of value.instruments) {
    if (
      !/^[A-Z0-9]{3,30}$/.test(item.symbol) ||
      !/^[A-Z0-9]{1,20}$/.test(item.baseAsset) ||
      item.quoteAsset !== "USDT" ||
      item.status !== "TRADING" ||
      symbols.has(item.symbol)
    )
      throw new Error("invalid_instrument_catalog");
    symbols.add(item.symbol);
  }
  return value.instruments;
}
