import { describe, expect, it } from "vitest";
import { activity, openOrders, uncertainOrders } from "./workspace-model.js";
import { account } from "../../lib/terminal-fixtures.js";
import { pageFromHash, pages } from "../../app/navigation.js";
import type { OrderRecord } from "../../lib/api-client.js";

const order = (state: string): OrderRecord => ({
  clientOrderId: state,
  strategyId: "ema",
  signalId: "s",
  symbol: "BTCUSDT",
  side: "BUY",
  type: "LIMIT",
  state,
  quantity: "0.0002",
  limitPrice: "100",
  executedQuantity: "0",
  cumulativeQuoteQuantity: "0",
  exchangeOrderId: null,
  createdAtMs: 1,
  updatedAtMs: 2
});
describe("seven-page workspace", () => {
  it("supports deep links for all seven pages and a safe default", () => {
    expect(pages).toHaveLength(7);
    for (const p of pages) expect(pageFromHash(`#/${p.id}`)).toBe(p.id);
    expect(pageFromHash("#/unknown")).toBe("overview");
  });
  it("keeps uncertain and pending orders visible, excludes terminal open counts", () => {
    const value = {
      ...account(),
      orders: [
        "NEW",
        "UNKNOWN",
        "PENDING_NEW",
        "PENDING_CANCEL",
        "FILLED",
        "CANCELED",
        "EXPIRED_IN_MATCH"
      ].map(order)
    };
    expect(openOrders(value)).toHaveLength(4);
    expect(uncertainOrders(value).map((o) => o.state)).toEqual([
      "UNKNOWN",
      "PENDING_NEW",
      "PENDING_CANCEL"
    ]);
    expect(openOrders(null)).toEqual([]);
  });
  it("sorts and bounds the activity feed without mutating account arrays", () => {
    const value = {
      ...account(),
      orders: [order("NEW")],
      riskEvents: Array.from({ length: 40 }, (_, i) => ({
        id: String(i),
        type: "risk",
        details: {},
        tsMs: i + 10
      }))
    };
    expect(activity(value)).toHaveLength(30);
    expect(activity(value)[0]?.time).toBe(49);
    expect(value.riskEvents[0]?.tsMs).toBe(10);
    expect(activity(null)).toEqual([]);
  });
});
