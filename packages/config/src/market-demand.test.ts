import { describe, expect, it } from "vitest";
import { demandedMarketSymbols } from "./market-demand.js";
const lease = (symbol: string) => `00000000-0000-0000-0000-000000000000|${symbol}`;
describe("market demand decoding", () => {
  it("deduplicates viewers and preserves BTC baseline", () => {
    expect(demandedMarketSymbols([lease("ETHUSDT"), lease("ETHUSDT"), lease("SOLUSDT")])).toEqual([
      "BTCUSDT",
      "ETHUSDT",
      "SOLUSDT"
    ]);
  });
  it.each(
    [null, ["garbage"], [lease("../bad")], Array.from({ length: 601 }, () => lease("ETHUSDT"))].map(
      (value) => ({ value })
    )
  )("rejects malformed/unbounded input", ({ value }) => {
    expect(() => demandedMarketSymbols(value)).toThrow();
  });
  it("refuses excessive unique subscriptions", () => {
    expect(() =>
      demandedMarketSymbols(["ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"].map(lease))
    ).toThrow("market_feed_capacity");
  });
});
