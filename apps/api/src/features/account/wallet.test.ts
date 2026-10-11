import { Decimal } from "@meridian/core";
import { describe, expect, it, vi } from "vitest";
import { createWalletReader, valueWallet, type WalletInput } from "./wallet.js";
import { createPortfolioReader, type MarkedPosition } from "./portfolio.js";
import type { Pool } from "pg";

const now = 100000;
const balance = (asset = "BTC", free = "2", locked = "1") => ({
  asset,
  free: new Decimal(free),
  locked: new Decimal(locked)
});
const input = (changes: Partial<WalletInput> = {}): WalletInput => ({
  observedAtMs: now,
  balances: [balance(), balance("USDT", "100", "20")],
  metadata: [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING" }],
  tickers: [{ symbol: "BTCUSDT", bidPrice: "99", askPrice: "101" }],
  ...changes
});
const position = (changes: Partial<MarkedPosition> = {}) =>
  ({ baseAsset: "BTC", quantity: "3", ...changes }) as MarkedPosition;
describe("read-only exchange wallet valuation and reconciliation", () => {
  it("includes free and locked balances and matches tracked base inventory", () => {
    const result = valueWallet(input(), [position()], now);
    expect(result.equity).toBe("420");
    expect(result.reconciliation).toBe("matched");
    expect(result.assets[0]).toMatchObject({
      free: "2",
      locked: "1",
      total: "3",
      value: "300",
      trackedQuantity: "3",
      difference: "0"
    });
  });
  it("reports opening/external inventory without inventing entry cost or profit", () => {
    const result = valueWallet(input(), [position({ quantity: "1" })], now);
    expect(result.equity).toBe("420");
    expect(result.reconciliation).toBe("unattributed");
    expect(result.assets[0]).toMatchObject({
      difference: "2",
      reason: "opening_or_external_inventory"
    });
    expect(result.assets[0]).not.toHaveProperty("avgEntry");
  });
  it("detects missing wallet inventory even when the exchange omits the asset", () => {
    const result = valueWallet(
      input({ balances: [balance("USDT", "100", "0")] }),
      [position()],
      now
    );
    expect(result.assets[0]).toMatchObject({
      total: "0",
      difference: "-3",
      reason: "ledger_exceeds_wallet"
    });
  });
  it("aggregates base quantities across symbols and handles unknown ledger metadata", () => {
    expect(
      valueWallet(input(), [position({ quantity: "1" }), position({ quantity: "2" })], now)
        .reconciliation
    ).toBe("matched");
    const result = valueWallet(input(), [position({ baseAsset: null, quantity: null })], now);
    expect(result.reconciliation).toBe("unavailable");
    expect(result.assets[0]!.trackedQuantity).toBeNull();
  });
  it("keeps unpriceable assets visible and withholds the full-wallet total", () => {
    const result = valueWallet(
      input({ balances: [balance(), balance("UNKNOWN", "1", "0")] }),
      [],
      now
    );
    expect(result.equity).toBeNull();
    expect(result.reason).toBe("unpriceable_wallet_assets");
    expect(result.assets.find((a) => a.asset === "UNKNOWN")?.value).toBeNull();
  });
  it("uses inverse and bounded bridge pairs rather than pretending stablecoins are at parity", () => {
    const result = valueWallet(
      input({
        balances: [balance("ALT", "2", "0"), balance("USDC", "4", "0")],
        metadata: [
          { symbol: "ALT BTC", baseAsset: "ALT", quoteAsset: "BTC" },
          { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" },
          { symbol: "USDTUSDC", baseAsset: "USDT", quoteAsset: "USDC" }
        ],
        tickers: [
          { symbol: "ALT BTC", bidPrice: "0.1", askPrice: "0.1" },
          { symbol: "BTCUSDT", bidPrice: "100", askPrice: "100" },
          { symbol: "USDTUSDC", bidPrice: "2", askPrice: "2" }
        ]
      }),
      [],
      now
    );
    expect(result.equity).toBe("22");
  });
  it.each([
    { bidPrice: "0", askPrice: "100" },
    { bidPrice: "101", askPrice: "100" }
  ])("rejects unusable quotes %j", (ticker) => {
    expect(
      valueWallet(input({ tickers: [{ symbol: "BTCUSDT", ...ticker }] }), [], now).equity
    ).toBeNull();
  });
  it("does not value halted symbols", () => {
    expect(
      valueWallet(
        input({
          metadata: [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "BREAK" }]
        }),
        [],
        now
      ).equity
    ).toBeNull();
  });
  it("rejects stale snapshots, duplicate balances and oversized wallets", () => {
    expect(valueWallet(input({ observedAtMs: now - 15001 }), [], now).reason).toBe(
      "wallet_snapshot_stale"
    );
    expect(valueWallet(input({ balances: [balance(), balance()] }), [], now).reason).toBe(
      "invalid_wallet_balance"
    );
    expect(
      valueWallet(input({ balances: Array.from({ length: 1001 }, () => balance()) }), [], now)
        .reason
    ).toBe("wallet_capacity");
  });
  it("coalesces reads and never serves stale success after a failed refresh", async () => {
    let time = now;
    const load = vi
      .fn()
      .mockResolvedValueOnce(input())
      .mockRejectedValueOnce(new Error("private URL"));
    const reader = createWalletReader(load, () => time);
    const results = await Promise.all([reader([]), reader([])]);
    expect(results[0].equity).toBe("420");
    expect(load).toHaveBeenCalledOnce();
    await reader([]);
    expect(load).toHaveBeenCalledOnce();
    time += 10000;
    const failed = await reader([]);
    expect(failed.equity).toBeNull();
    expect(failed.reason).toBe("wallet_snapshot_unavailable");
    expect((await reader([])).equity).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("attaches wallet equity separately from persisted-fill PnL and rechecks slow marks", async () => {
    let time = now;
    const pool = {
      query: async () => ({
        rows: [
          {
            symbol: "BTCUSDT",
            side: "BUY",
            quantity: "1",
            price: "80",
            fee: "0",
            fee_asset: "USDT",
            event_time_ms: "1"
          }
        ]
      })
    } as unknown as Pool;
    const reader = createPortfolioReader(
      pool,
      {
        metadata: async () => input().metadata,
        mark: async () => ({ price: "100", observedAtMs: now })
      },
      "testnet",
      () => time,
      async (positions) => {
        time += 16000;
        return valueWallet(input({ observedAtMs: time }), positions, time);
      }
    );
    const result = await reader();
    expect(result.equity).toBe("420");
    expect(result.wallet?.reconciliation).toBe("unattributed");
    expect(result.positions[0]).toMatchObject({
      realizedPnl: "0",
      unrealizedPnl: null,
      reason: "mark_unavailable"
    });
  });
});
