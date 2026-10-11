import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { applySpotFill, type SpotInventory } from "./spot-accounting.js";

const empty: SpotInventory = {
  quantity: new Decimal(0),
  cost: new Decimal(0),
  realizedPnl: new Decimal(0)
};
const fill = (side: "BUY" | "SELL", qty: string, price: string, fee: string, feeAsset: string) => ({
  side,
  quantity: new Decimal(qty),
  price: new Decimal(price),
  fee: new Decimal(fee),
  feeAsset,
  baseAsset: "BTC",
  quoteAsset: "USDT"
});
describe("canonical spot accounting", () => {
  it("includes quote fees in cost and subtracts them from proceeds", () => {
    const bought = applySpotFill(empty, fill("BUY", "2", "100", "2", "USDT"));
    const sold = applySpotFill(bought, fill("SELL", "1", "120", "1", "USDT"));
    expect(sold.quantity.toFixed()).toBe("1");
    expect(sold.cost.toFixed()).toBe("101");
    expect(sold.realizedPnl.toFixed()).toBe("18");
  });
  it("reduces net inventory for base BUY fees and removes cost for base SELL fees", () => {
    const bought = applySpotFill(empty, fill("BUY", "1", "99", "0.01", "BTC"));
    expect(bought.quantity.toFixed()).toBe("0.99");
    expect(bought.cost.toFixed()).toBe("99");
    const sold = applySpotFill(bought, fill("SELL", "0.98", "110", "0.01", "BTC"));
    expect(sold.quantity.toFixed()).toBe("0");
    expect(sold.cost.toFixed()).toBe("0");
    expect(sold.realizedPnl.toFixed()).toBe("8.8");
  });
  it("refuses missing opening basis, unknown historical fee conversions and malformed fills", () => {
    expect(() => applySpotFill(empty, fill("SELL", "1", "100", "0", "USDT"))).toThrow(
      "opening_cost_basis"
    );
    expect(() => applySpotFill(empty, fill("BUY", "1", "100", "1", "BNB"))).toThrow(
      "historical_fee"
    );
    expect(() => applySpotFill(empty, fill("BUY", "1", "100", "1", "BTC"))).toThrow("net_quantity");
    expect(() => applySpotFill(empty, fill("BUY", "NaN", "100", "0", "USDT"))).toThrow(
      "invalid_fill"
    );
  });
});
