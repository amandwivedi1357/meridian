import { describe, it, expect } from "vitest";
import { buildBalanceReport, reportMarks } from "./report-model.js";
import type { FillRecord } from "../../lib/api-client.js";
const fill = (overrides: Partial<FillRecord> = {}): FillRecord => ({
  clientOrderId: "order",
  strategyId: "manual",
  executionId: "1",
  tradeId: "1",
  symbol: "BTCUSDT",
  side: "BUY",
  quantity: "1",
  price: "10",
  fee: "0",
  feeAsset: "USDT",
  eventTimeMs: 1,
  ...overrides
});
describe("complete ledger reports", () => {
  it("never assigns ETH market prices to BTC holdings", () => {
    const marks = reportMarks([{ symbol: "BTCUSDT", markPrice: "12" }], {
      symbol: "ETHUSDT",
      price: "2000"
    });
    expect(buildBalanceReport([fill()], marks, true)?.equity).toBe("102.00000000");
  });
  it("uses all fills beyond the recent 100 and rejects truncated history", () => {
    const fills = Array.from({ length: 102 }, (_, i) =>
      fill({
        executionId: String(i),
        eventTimeMs: i,
        side: i % 2 ? "SELL" : "BUY",
        price: i % 2 ? "11" : "10"
      })
    );
    expect(buildBalanceReport(fills, new Map(), true)?.equity).toBe("151.00000000");
    expect(buildBalanceReport(fills.slice(-100), new Map(), false)).toBeNull();
  });
  it("withholds figures for unknown opening inventory, missing marks and unsupported fee valuation", () => {
    expect(buildBalanceReport([fill({ side: "SELL" })], new Map(), true)).toBeNull();
    expect(buildBalanceReport([fill()], new Map(), true)).toBeNull();
    expect(
      buildBalanceReport([fill({ fee: "1", feeAsset: "BNB" })], new Map([["BTCUSDT", "12"]]), true)
    ).toBeNull();
  });
});
