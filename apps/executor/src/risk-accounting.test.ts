import { Decimal } from "@meridian/core";
import { describe, expect, it } from "vitest";
import { calculateDailyRealizedPnl, type RiskFill } from "./risk-accounting.js";

const now = 2 * 86_400_000;
function fill(side: "BUY" | "SELL", overrides: Partial<RiskFill> = {}): RiskFill {
  return {
    strategyId: "ema",
    symbol: "BTCUSDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    side,
    quantity: new Decimal(1),
    price: new Decimal(side === "BUY" ? 100 : 90),
    fee: new Decimal(1),
    feeAsset: "USDT",
    eventTimeMs: side === "BUY" ? now - 1000 : now,
    ...overrides
  };
}
const calculate = (fills: readonly RiskFill[]) =>
  calculateDailyRealizedPnl(fills, now, "USDT", () => new Decimal(1));
describe("risk daily realized accounting", () => {
  it("retains yesterday's cost basis but counts only today's realizations", () => {
    const result = calculate([fill("BUY"), fill("SELL")]);
    expect(result.globalPnl.toFixed()).toBe("-12");
    expect(result.strategyPnl.get("ema")?.toFixed()).toBe("-12");
  });
  it("removes base fees from bought inventory without losing their cost", () => {
    const result = calculate([
      fill("BUY", { feeAsset: "BTC", fee: new Decimal("0.1") }),
      fill("SELL", { quantity: new Decimal("0.9"), fee: new Decimal(0), price: new Decimal(100) })
    ]);
    expect(result.globalPnl.toFixed()).toBe("-10");
  });
  it("charges base-asset sell fees to the removed inventory basis", () => {
    const result = calculate([
      fill("BUY", { quantity: new Decimal("1.1"), fee: new Decimal(0) }),
      fill("SELL", { feeAsset: "BTC", fee: new Decimal("0.1"), price: new Decimal(100) })
    ]);
    expect(result.globalPnl.toFixed()).toBe("-10");
  });
  it("does not invent zero-cost inventory for external holdings", () => {
    expect(() => calculate([fill("SELL")])).toThrow("cost basis unavailable");
  });
  it("keeps strategy inventory separate", () => {
    expect(() => calculate([fill("BUY"), fill("SELL", { strategyId: "other" })])).toThrow(
      "cost basis unavailable"
    );
  });
  it("excludes completed prior-day losses", () => {
    expect(
      calculate([
        fill("BUY", { eventTimeMs: now - 2000 }),
        fill("SELL", { eventTimeMs: now - 1000 })
      ]).globalPnl.isZero()
    ).toBe(true);
  });
});
