import { describe, expect, it } from "vitest";
import { instrumentCatalog } from "./instrument-catalog.js";
const item = { symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT", status: "TRADING" };
const response = (instruments = [item]) => ({
  checkedAt: Date.now(),
  quoteAsset: "USDT",
  instruments
});
describe("instrument catalog", () => {
  it("accepts actual metadata rather than inferring assets from symbol strings", () => {
    expect(instrumentCatalog(response())).toEqual([item]);
  });
  it.each(
    [
      [],
      [item, item],
      [{ ...item, status: "HALT" }],
      [{ ...item, quoteAsset: "BTC" }],
      [{ ...item, symbol: "../ETH" }]
    ].map((items) => ({ items }))
  )("rejects empty/invalid/duplicate catalogs", ({ items }) => {
    expect(() => instrumentCatalog(response(items))).toThrow("invalid_instrument_catalog");
  });
});
