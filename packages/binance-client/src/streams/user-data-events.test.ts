import { describe, expect, it } from "vitest";
import { parseUserDataEvent } from "./user-data-events.js";

export const executionFixture = {
  subscriptionId: 0,
  event: {
    e: "executionReport",
    E: 2_000,
    T: 1_999,
    s: "BTCUSDT",
    c: "meridian-test-1",
    C: "",
    S: "BUY",
    o: "LIMIT",
    x: "TRADE",
    X: "PARTIALLY_FILLED",
    i: 123,
    I: 456,
    q: "0.00200000",
    p: "85000.00000000",
    l: "0.00100000",
    L: "85000.00000000",
    z: "0.00100000",
    Z: "85.00000000",
    n: "0.00000100",
    N: "BTC",
    t: 789,
    m: false
  }
};

describe("parseUserDataEvent", () => {
  it("maps partial fills with Decimal-safe amounts, commission asset and stable identities", () => {
    const result = parseUserDataEvent(executionFixture);
    expect(result?.kind).toBe("order-update");
    if (result?.kind !== "order-update") throw new Error("Expected order update");
    expect(result.lastQuantity.toString()).toBe("0.001");
    expect(result.lastPrice.toString()).toBe("85000");
    expect(result.cumulativeQuoteQuantity.toString()).toBe("85");
    expect(result.commission.toString()).toBe("0.000001");
    expect(result.commissionAsset).toBe("BTC");
    expect(result.orderId).toBe("123");
    expect(result.executionId).toBe("456");
    expect(result.tradeId).toBe("789");
    expect(result.status).toBe("PARTIALLY_FILLED");
  });

  it("accepts non-trade order updates with no trade ID or fee asset", () => {
    const result = parseUserDataEvent({
      ...executionFixture,
      event: {
        ...executionFixture.event,
        x: "CANCELED",
        X: "CANCELED",
        l: "0",
        L: "0",
        n: "0",
        N: null,
        t: -1,
        C: "original-id"
      }
    });
    expect(result).toMatchObject({
      kind: "order-update",
      originalClientOrderId: "original-id",
      tradeId: undefined,
      commissionAsset: null
    });
  });

  it("preserves zero-fee trades with an unspecified commission asset", () => {
    expect(
      parseUserDataEvent({
        ...executionFixture,
        event: { ...executionFixture.event, n: "0", N: null }
      })
    ).toMatchObject({ commissionAsset: null });
  });

  it("maps free and locked account balances without precision loss", () => {
    const result = parseUserDataEvent({
      subscriptionId: 0,
      event: {
        e: "outboundAccountPosition",
        E: 2_000,
        u: 1_999,
        B: [{ a: "USDT", f: "10000.123456789012345678", l: "1.00000000" }]
      }
    });
    if (result?.kind !== "account-update") throw new Error("Expected account update");
    expect(result.balances[0]?.free.toString()).toBe("10000.123456789012345678");
    expect(result.balances[0]?.locked.toString()).toBe("1");
  });

  it("maps signed balance deltas", () => {
    const result = parseUserDataEvent({
      subscriptionId: 0,
      event: { e: "balanceUpdate", E: 2_000, T: 1_999, a: "BTC", d: "-0.00100000" }
    });
    if (result?.kind !== "balance-update") throw new Error("Expected balance update");
    expect(result.delta.toString()).toBe("-0.001");
  });

  it("ignores unknown event types with a valid envelope", () => {
    expect(
      parseUserDataEvent({ subscriptionId: 0, event: { e: "listStatus", E: 2_000 } })
    ).toBeUndefined();
  });

  it.each([
    { i: Number.MAX_SAFE_INTEGER + 1 },
    { I: -1 },
    { l: "NaN" },
    { n: 0 },
    { N: "" },
    { x: "MYSTERY" },
    { X: "MYSTERY" },
    { t: -2 },
    { x: "TRADE", t: -1 },
    { l: "0" },
    { L: "0" },
    { n: "0.01", N: null }
  ])("rejects invalid execution fields %j", (fields) => {
    expect(() =>
      parseUserDataEvent({ ...executionFixture, event: { ...executionFixture.event, ...fields } })
    ).toThrow("execution report");
  });

  it.each([null, {}, { subscriptionId: -1, event: { e: "balanceUpdate", E: 2_000 } }])(
    "rejects invalid envelopes %j",
    (value) => {
      expect(() => parseUserDataEvent(value)).toThrow("envelope");
    }
  );

  it("rejects invalid balance payloads without echoing their values", () => {
    expect(() =>
      parseUserDataEvent({
        subscriptionId: 0,
        event: { e: "balanceUpdate", E: 2_000, T: 1_999, a: "BTC", d: "sensitive" }
      })
    ).toThrow("Invalid balance update");
  });
});
