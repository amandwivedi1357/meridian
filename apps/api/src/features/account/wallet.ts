import { Decimal, type BalanceSnapshot } from "@meridian/core";
import { z } from "zod";
import type { MarkedPosition } from "./portfolio.js";

const amount = z
  .string()
  .max(256)
  .regex(/^-?\d+(\.\d+)?$/);
export const walletSchema = z.object({
  scope: z.literal("exchange-wallet"),
  quoteAsset: z.literal("USDT"),
  observedAtMs: z.number().int().nullable(),
  equity: amount.nullable(),
  status: z.enum(["available", "unavailable"]),
  reason: z.string().nullable(),
  reconciliation: z.enum(["matched", "unattributed", "unavailable"]),
  assets: z
    .array(
      z.object({
        asset: z.string(),
        free: amount,
        locked: amount,
        total: amount,
        price: amount.nullable(),
        value: amount.nullable(),
        trackedQuantity: amount.nullable(),
        difference: amount.nullable(),
        reason: z.string().nullable()
      })
    )
    .max(1000)
});
export type WalletSnapshot = z.infer<typeof walletSchema>;
export interface WalletInput {
  observedAtMs: number;
  balances: readonly BalanceSnapshot[];
  metadata: readonly { symbol: string; baseAsset: string; quoteAsset: string; status?: string }[];
  tickers: readonly { symbol: string; bidPrice: string; askPrice: string }[];
}
export type WalletReader = (positions: readonly MarkedPosition[]) => Promise<WalletSnapshot>;
export function unavailableWallet(reason: string): WalletSnapshot {
  return {
    scope: "exchange-wallet",
    quoteAsset: "USDT",
    observedAtMs: null,
    equity: null,
    status: "unavailable",
    reason,
    reconciliation: "unavailable",
    assets: []
  };
}

export function valueWallet(
  input: WalletInput,
  positions: readonly MarkedPosition[],
  now = Date.now()
): WalletSnapshot {
  if (
    !Number.isSafeInteger(input.observedAtMs) ||
    now - input.observedAtMs > 15000 ||
    input.observedAtMs > now + 5000
  )
    return unavailableWallet("wallet_snapshot_stale");
  if (input.balances.length > 1000 || input.metadata.length > 10000 || input.tickers.length > 10000)
    return unavailableWallet("wallet_capacity");
  const quotes = new Map(input.tickers.map((t) => [t.symbol, t]));
  const graph = new Map<string, { asset: string; rate: Decimal }[]>();
  const add = (from: string, to: string, rate: Decimal) =>
    graph.set(from, [...(graph.get(from) ?? []), { asset: to, rate }]);
  for (const m of input.metadata) {
    const t = quotes.get(m.symbol);
    if (!t || (m.status && m.status !== "TRADING") || m.baseAsset === m.quoteAsset) continue;
    const bid = new Decimal(t.bidPrice),
      ask = new Decimal(t.askPrice);
    if (!bid.isFinite() || !ask.isFinite() || bid.lte(0) || ask.lt(bid)) continue;
    const mid = bid.plus(ask).div(2);
    add(m.baseAsset, m.quoteAsset, mid);
    add(m.quoteAsset, m.baseAsset, new Decimal(1).div(mid));
  }
  const rate = (asset: string): Decimal | null => {
    if (asset === "USDT") return new Decimal(1);
    const edges = graph.get(asset) ?? [];
    const direct = edges.find((e) => e.asset === "USDT");
    if (direct) return direct.rate;
    for (const bridge of ["BTC", "USDC", "ETH", "BNB"]) {
      const first = edges.find((e) => e.asset === bridge),
        second = graph.get(bridge)?.find((e) => e.asset === "USDT");
      if (first && second) return first.rate.mul(second.rate);
    }
    return null;
  };
  const tracked = new Map<string, Decimal | null>();
  const unknownMetadata = positions.some((p) => !p.baseAsset);
  for (const p of positions) {
    if (!p.baseAsset) continue;
    const prior = tracked.get(p.baseAsset) ?? new Decimal(0);
    tracked.set(
      p.baseAsset,
      p.quantity === null || tracked.get(p.baseAsset) === null ? null : prior.plus(p.quantity)
    );
  }
  const balances = new Map<string, BalanceSnapshot>();
  for (const b of input.balances) {
    if (
      !b.asset ||
      balances.has(b.asset) ||
      !b.free.isFinite() ||
      !b.locked.isFinite() ||
      b.free.lt(0) ||
      b.locked.lt(0)
    )
      return unavailableWallet("invalid_wallet_balance");
    balances.set(b.asset, b);
  }
  for (const asset of tracked.keys())
    if (!balances.has(asset))
      balances.set(asset, { asset, free: new Decimal(0), locked: new Decimal(0) });
  const assets: WalletSnapshot["assets"] = [];
  for (const b of [...balances.values()].sort((a, b) => a.asset.localeCompare(b.asset))) {
    const total = b.free.plus(b.locked);
    if (total.isZero() && !tracked.has(b.asset)) continue;
    const price = total.isZero() ? new Decimal(0) : rate(b.asset);
    const qty =
      b.asset === "USDT" || unknownMetadata
        ? null
        : tracked.has(b.asset)
          ? tracked.get(b.asset)!
          : new Decimal(0);
    const difference = qty === null ? null : total.minus(qty);
    const reason =
      b.asset === "USDT"
        ? null
        : qty === null
          ? "ledger_inventory_unavailable"
          : difference!.gt(0)
            ? "opening_or_external_inventory"
            : difference!.lt(0)
              ? "ledger_exceeds_wallet"
              : null;
    assets.push({
      asset: b.asset,
      free: b.free.toFixed(),
      locked: b.locked.toFixed(),
      total: total.toFixed(),
      price: price?.toFixed() ?? null,
      value: price ? total.mul(price).toFixed() : null,
      trackedQuantity: qty?.toFixed() ?? null,
      difference: difference?.toFixed() ?? null,
      reason
    });
  }
  const unpriced = assets.some((a) => a.value === null);
  if (assets.length > 1000) return unavailableWallet("wallet_capacity");
  return {
    scope: "exchange-wallet",
    quoteAsset: "USDT",
    observedAtMs: input.observedAtMs,
    equity: unpriced ? null : assets.reduce((s, a) => s.plus(a.value!), new Decimal(0)).toFixed(),
    status: unpriced ? "unavailable" : "available",
    reason: unpriced ? "unpriceable_wallet_assets" : null,
    reconciliation: assets.some((a) => a.reason === "ledger_inventory_unavailable")
      ? "unavailable"
      : assets.some((a) => a.reason !== null)
        ? "unattributed"
        : "matched",
    assets
  };
}

export function createWalletReader(load: () => Promise<WalletInput>, now = Date.now): WalletReader {
  let cached: WalletInput | undefined, pending: Promise<WalletInput> | undefined;
  let attemptedAt = -Infinity;
  return async (positions) => {
    if (!pending && now() - attemptedAt >= 10000) {
      attemptedAt = now();
      pending = load()
        .then((input) => {
          cached = input;
          return input;
        })
        .finally(() => {
          pending = undefined;
        });
    }
    try {
      if (pending) await pending;
    } catch {
      cached = undefined;
      return unavailableWallet("wallet_snapshot_unavailable");
    }
    return cached
      ? valueWallet(cached, positions, now())
      : unavailableWallet("wallet_snapshot_unavailable");
  };
}
