import { Decimal } from "@meridian/core";
import type { BinanceRestClient } from "@meridian/binance-client";
import { describe, expect, it, vi } from "vitest";
import { createAllocatedAccountState } from "./allocated-account-state.js";

function fixture() {
  const assertPolicy = vi.fn(async () => {});
  const getBalances = vi.fn(async () => [
    { asset: "USDT", free: new Decimal(990), locked: new Decimal(0) },
    { asset: "BTC", free: new Decimal("1.099"), locked: new Decimal(0) },
    { asset: "FAUCET", free: new Decimal(1000), locked: new Decimal(0) }
  ]);
  const getExchangeInfo = vi.fn(async () => ({
    symbols: [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING" }]
  })) as unknown as BinanceRestClient["getExchangeInfo"];
  const account = createAllocatedAccountState({
    policy: { id: "check", quoteAsset: "USDT", initialQuote: "100", symbols: ["BTCUSDT"] },
    publicClient: { getExchangeInfo },
    tradingClient: { getBalances, openOrders: async () => [] },
    fillReader: {
      listFills: async () => [
        {
          symbol: "BTCUSDT",
          side: "BUY",
          quantity: "0.1",
          price: "100",
          fee: "0.001",
          feeAsset: "BTC",
          eventTimeMs: 1
        }
      ]
    },
    assertPolicy,
    backingBaseline: async () => ({ USDT: "1000", BTC: "1" }),
    listManagedOrders: async () => []
  });
  return { account, assertPolicy, getBalances };
}

describe("allocated engine account", () => {
  it("requires a fresh view and excludes pre-existing wallet holdings", async () => {
    const { account } = fixture();
    expect(() => account.position("BTCUSDT")).toThrow("refreshed");
    await account.refresh();
    expect(account.balance("USDT").toFixed()).toBe("90");
    expect(account.position("BTCUSDT").quantity.toFixed()).toBe("0.099");
    expect(
      account.position("BTCUSDT").avgEntry.mul("0.099").minus(10).abs().lt("0.000000000001")
    ).toBe(true);
    expect(account.balance("FAUCET").toFixed()).toBe("0");
    expect(account.balanceSnapshot("FAUCET").locked.toFixed()).toBe("0");
    expect(() => account.position("ETHUSDT")).toThrow("outside");
  });
  it("invalidates the old view when policy verification fails", async () => {
    const { account, assertPolicy } = fixture();
    await account.refresh();
    assertPolicy.mockRejectedValueOnce(new Error("policy drift"));
    await expect(account.refresh()).rejects.toThrow("policy drift");
    expect(() => account.balance("USDT")).toThrow("refreshed");
  });
  it("blocks even sufficiently funded external wallet changes", async () => {
    const { account, getBalances } = fixture();
    await account.refresh();
    getBalances.mockResolvedValueOnce([
      { asset: "USDT", free: new Decimal(991), locked: new Decimal(0) },
      { asset: "BTC", free: new Decimal("1.099"), locked: new Decimal(0) }
    ]);
    await expect(account.refresh()).rejects.toThrow("drift");
    expect(() => account.position("BTCUSDT")).toThrow("refreshed");
  });
});
