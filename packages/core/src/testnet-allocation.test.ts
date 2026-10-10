import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  allocationFromEnv,
  parseTestnetAllocation,
  projectTestnetAllocation,
  type AllocationFill
} from "./testnet-allocation.js";

const policy = { id: "bounded", quoteAsset: "USDT", initialQuote: "100", symbols: ["BTCUSDT"] };
const metadata = [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING" }];
const balances = [
  { asset: "USDT", free: new Decimal(10000), locked: new Decimal(0) },
  { asset: "BTC", free: new Decimal(1), locked: new Decimal(0) },
  { asset: "FAUCET", free: new Decimal(999), locked: new Decimal(0) }
];
const buy: AllocationFill = {
  symbol: "BTCUSDT",
  side: "BUY",
  quantity: "0.0002",
  price: "80000",
  fee: "0.0000002",
  feeAsset: "BTC",
  eventTimeMs: 1
};
function project(override: Partial<Parameters<typeof projectTestnetAllocation>[0]> = {}) {
  return projectTestnetAllocation({
    policy,
    metadata,
    balances,
    fills: [],
    openOrders: [],
    managedOrders: [],
    ...override
  });
}
describe("explicit Testnet capital allocation", () => {
  it("defaults to full-wallet mode and refuses allocated production", () => {
    expect(allocationFromEnv({})).toBeUndefined();
    expect(() =>
      allocationFromEnv({
        BINANCE_ENV: "production",
        MERIDIAN_TESTNET_ALLOCATION: JSON.stringify(policy)
      })
    ).toThrow("Testnet-only");
  });
  it.each([
    null,
    {},
    { ...policy, initialQuote: "0" },
    { ...policy, initialQuote: "NaN" },
    { ...policy, initialQuote: 100 },
    { ...policy, symbols: [] },
    { ...policy, symbols: ["BTCUSDT", "BTCUSDT"] },
    { ...policy, ignoreAssets: true }
  ])("rejects malformed/implicit exclusion policy %j", (value) => {
    expect(() => parseTestnetAllocation(value)).toThrow();
  });
  it("allocates exact quote capital and no pre-existing BTC; exclusions are explicit", () => {
    const view = project();
    expect(view.balances.map((b) => [b.asset, b.free.toFixed()])).toEqual([
      ["USDT", "100"],
      ["BTC", "0"]
    ]);
    expect(view.excludedWalletAssets).toEqual(["FAUCET"]);
    expect(view.positions.get("BTCUSDT")!.quantity.toFixed()).toBe("0");
  });
  it("accounts for buy base fees, cost basis and sell quote fees without borrowing wallet inventory", () => {
    const sell: AllocationFill = {
      ...buy,
      side: "SELL",
      quantity: "0.00019",
      price: "81000",
      fee: "0.01539",
      feeAsset: "USDT",
      eventTimeMs: 2
    };
    const view = project({ fills: [sell, buy] });
    const position = view.positions.get("BTCUSDT")!;
    expect(position.quantity.toFixed()).toBe("0.0000098");
    expect(view.balances.find((b) => b.asset === "USDT")!.free.toFixed()).toBe("99.37461");
    expect(position.avgEntry.mul("0.0001998").minus(16).abs().lt("0.000000000001")).toBe(true);
    expect(position.realizedPnl.toNumber()).toBeCloseTo(15.37461 - (16 / 0.0001998) * 0.00019, 8);
  });
  it("debits base-asset fees on sells", () => {
    const view = project({
      fills: [
        { ...buy, fee: "0" },
        { ...buy, side: "SELL", quantity: "0.0001", fee: "0.0000001", eventTimeMs: 2 }
      ]
    });
    expect(view.positions.get("BTCUSDT")!.quantity.toFixed()).toBe("0.0000999");
  });
  it.each([
    { fills: [{ ...buy, side: "SELL" as const }] },
    { fills: [{ ...buy, feeAsset: "BNB", fee: "0.01" }] },
    { fills: [{ ...buy, symbol: "ETHUSDT" }] },
    { fills: [{ ...buy, quantity: "0.01" }] },
    { fills: [{ ...buy, fee: "-1" }] }
  ])("rejects unsupported/exhausted managed fills %j", ({ fills }) =>
    expect(() => project({ fills })).toThrow()
  );
  it("refuses missing, depleted or externally locked backing funds", () => {
    expect(() => project({ balances: balances.slice(1) })).toThrow("funding unavailable");
    expect(() =>
      project({
        balances: balances.map((b) => (b.asset === "USDT" ? { ...b, free: new Decimal(99) } : b))
      })
    ).toThrow();
    expect(() =>
      project({
        balances: balances.map((b) =>
          b.asset === "USDT" ? { ...b, free: new Decimal(0), locked: new Decimal(100) } : b
        )
      })
    ).toThrow();
  });
  it("locks managed buy notional and rejects any unrelated order", () => {
    const order = {
      symbol: "BTCUSDT",
      clientOrderId: "owned",
      side: "BUY" as const,
      origQty: "0.0002",
      executedQty: "0",
      price: "80000"
    };
    expect(() => project({ openOrders: [order] })).toThrow("Unmanaged");
    const view = project({
      openOrders: [order],
      managedOrders: [{ clientOrderId: "owned", symbol: "BTCUSDT" }],
      balances: balances.map((b) => (b.asset === "USDT" ? { ...b, locked: new Decimal(16) } : b))
    });
    expect(view.balances[0]!.free.toFixed()).toBe("84");
    expect(view.balances[0]!.locked.toFixed()).toBe("16");
  });
  it("fails closed on metadata mismatch or duplicate account balances", () => {
    expect(() => project({ metadata: [{ ...metadata[0]!, quoteAsset: "USDC" }] })).toThrow();
    expect(() => project({ balances: [...balances, balances[0]!] })).toThrow();
  });
  it("detects external wallet activity/reset even when remaining funds could cover the allocation", () => {
    const backingBaseline = project().backingTotals;
    expect(project({ backingBaseline }).balances[0]!.free.toFixed()).toBe("100");
    expect(() =>
      project({
        backingBaseline,
        balances: balances.map((b) => (b.asset === "USDT" ? { ...b, free: new Decimal(9999) } : b))
      })
    ).toThrow("wallet drift");
    expect(() =>
      project({
        backingBaseline,
        balances: balances.map((b) => (b.asset === "BTC" ? { ...b, free: new Decimal(2) } : b))
      })
    ).toThrow("wallet drift");
  });
});
