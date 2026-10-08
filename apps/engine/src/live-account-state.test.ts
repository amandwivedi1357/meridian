import { Decimal, type BalanceSnapshot } from "@meridian/core";
import { describe, expect, it, vi } from "vitest";

import { createLiveAccountState, type LiveFillRow } from "./live-account-state.js";

function fill(override: Partial<LiveFillRow> = {}): LiveFillRow {
  return {
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: "1",
    price: "100",
    fee: "0",
    feeAsset: "USDT",
    eventTimeMs: 1_000,
    ...override
  };
}

function balance(asset: string, free: string, locked = "0"): BalanceSnapshot {
  return {
    asset,
    free: new Decimal(free),
    locked: new Decimal(locked)
  };
}

describe("createLiveAccountState", () => {
  it("fails closed if strategy reads position or balance before the first refresh", () => {
    const state = createLiveAccountState({
      listFills: vi.fn(async () => []),
      getBalances: vi.fn(async () => [])
    });

    expect(() => state.position("BTCUSDT")).toThrow("Live account state has not been refreshed");
    expect(() => state.balance("USDT")).toThrow("Live account state has not been refreshed");
  });

  it("serves balances from the exchange account snapshot, including locked funds", async () => {
    const state = createLiveAccountState({
      listFills: vi.fn(async () => []),
      getBalances: vi.fn(async () => [balance("USDT", "950.25", "49.75")])
    });

    await state.refresh();

    expect(state.balance("USDT").toString()).toBe("950.25");
    expect(state.balanceSnapshot("USDT")).toEqual({
      asset: "USDT",
      free: new Decimal("950.25"),
      locked: new Decimal("49.75")
    });
  });

  it("derives live strategy positions from persisted fills in event-time order", async () => {
    const state = createLiveAccountState({
      listFills: vi.fn(async () => [
        fill({ side: "SELL", quantity: "0.4", price: "120", eventTimeMs: 3_000 }),
        fill({ side: "BUY", quantity: "1", price: "100", eventTimeMs: 1_000 })
      ]),
      getBalances: vi.fn(async () => [balance("USDT", "1000")])
    });

    await state.refresh();

    const position = state.position("BTCUSDT");

    expect(position.symbol).toBe("BTCUSDT");
    expect(position.quantity.toString()).toBe("0.6");
    expect(position.avgEntry.toString()).toBe("100");
    expect(position.realizedPnl.toString()).toBe("8");
  });

  it("nets base-asset fees from local position quantity", async () => {
    const state = createLiveAccountState({
      listFills: vi.fn(async () => [
        fill({
          side: "BUY",
          quantity: "1",
          price: "100",
          fee: "0.001",
          feeAsset: "BTC"
        })
      ]),
      getBalances: vi.fn(async () => [balance("BTC", "0.999")])
    });

    await state.refresh();

    const position = state.position("BTCUSDT");

    expect(position.quantity.toString()).toBe("0.999");
    expect(position.avgEntry.toString()).toBe("100");
  });
});
