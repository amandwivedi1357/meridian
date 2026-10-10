import { Decimal } from "decimal.js";
import type { BalanceSnapshot } from "./exchange.js";

export interface TestnetAllocation {
  id: string;
  quoteAsset: string;
  initialQuote: string;
  symbols: readonly string[];
}
export function parseTestnetAllocation(value: unknown): TestnetAllocation {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid Testnet allocation");
  const p = value as Record<string, unknown>;
  if (
    Object.keys(p).some((key) => !["id", "quoteAsset", "initialQuote", "symbols"].includes(key)) ||
    typeof p.id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,32}$/.test(p.id) ||
    typeof p.quoteAsset !== "string" ||
    !/^[A-Z0-9]{1,20}$/.test(p.quoteAsset) ||
    typeof p.initialQuote !== "string" ||
    !/^\d+(\.\d+)?$/.test(p.initialQuote) ||
    !new Decimal(p.initialQuote).isFinite() ||
    new Decimal(p.initialQuote).lte(0) ||
    !Array.isArray(p.symbols) ||
    p.symbols.length === 0 ||
    p.symbols.some((s) => typeof s !== "string" || !/^[A-Z0-9]{2,30}$/.test(s)) ||
    new Set(p.symbols).size !== p.symbols.length
  )
    throw new Error("Invalid Testnet allocation");
  return {
    id: p.id,
    quoteAsset: p.quoteAsset,
    initialQuote: new Decimal(p.initialQuote).toFixed(),
    symbols: [...p.symbols].sort()
  };
}
export function allocationFromEnv(
  env: Record<string, string | undefined>
): TestnetAllocation | undefined {
  const value = env.MERIDIAN_TESTNET_ALLOCATION;
  if (value === undefined) return undefined;
  if ((env.BINANCE_ENV ?? "testnet") !== "testnet")
    throw new Error("Allocated portfolio is Testnet-only");
  return parseTestnetAllocation(JSON.parse(value));
}
export interface AllocationFill {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: string;
  price: string;
  fee: string;
  feeAsset: string;
  eventTimeMs: number;
}
export interface AllocationOrder {
  symbol: string;
  clientOrderId: string;
  side: "BUY" | "SELL";
  origQty: string;
  executedQty: string;
  price: string;
}
export function projectTestnetAllocation(options: {
  policy: TestnetAllocation;
  metadata: readonly { symbol: string; baseAsset: string; quoteAsset: string; status: string }[];
  balances: readonly BalanceSnapshot[];
  fills: readonly AllocationFill[];
  openOrders: readonly AllocationOrder[];
  managedOrders: readonly { clientOrderId: string; symbol: string }[];
  backingBaseline?: Readonly<Record<string, string>>;
}) {
  const policy = parseTestnetAllocation(options.policy);
  const symbols = new Map(
    policy.symbols.map((symbol) => {
      const m = options.metadata.find(
        (entry) => entry.symbol === symbol && entry.status === "TRADING"
      );
      if (!m || m.quoteAsset !== policy.quoteAsset || m.baseAsset === policy.quoteAsset)
        throw new Error("Allocation symbol metadata unavailable");
      return [symbol, m] as const;
    })
  );
  if (new Set([...symbols.values()].map((m) => m.baseAsset)).size !== symbols.size)
    throw new Error("Allocation aliases share a base asset");
  const total = new Map<string, Decimal>([[policy.quoteAsset, new Decimal(policy.initialQuote)]]);
  const locked = new Map<string, Decimal>();
  const costs = new Map<string, Decimal>();
  const realized = new Map<string, Decimal>();
  for (const m of symbols.values()) total.set(m.baseAsset, new Decimal(0));
  for (const fill of [...options.fills].sort((a, b) => a.eventTimeMs - b.eventTimeMs)) {
    const m = symbols.get(fill.symbol);
    const qty = new Decimal(fill.quantity),
      price = new Decimal(fill.price),
      fee = new Decimal(fill.fee);
    if (
      !m ||
      !Number.isSafeInteger(fill.eventTimeMs) ||
      fill.eventTimeMs < 0 ||
      !qty.isFinite() ||
      qty.lte(0) ||
      !price.isFinite() ||
      price.lte(0) ||
      !fee.isFinite() ||
      fee.lt(0) ||
      (fill.side !== "BUY" && fill.side !== "SELL") ||
      (!fee.isZero() && fill.feeAsset !== m.baseAsset && fill.feeAsset !== policy.quoteAsset)
    ) {
      throw new Error("Allocation fill or fee valuation unsupported");
    }
    const direction = fill.side === "BUY" ? 1 : -1;
    const previousQuantity = total.get(m.baseAsset)!;
    const previousCost = costs.get(m.baseAsset) ?? new Decimal(0);
    const baseFee = fill.feeAsset === m.baseAsset ? fee : new Decimal(0);
    const quoteFee = fill.feeAsset === policy.quoteAsset ? fee : new Decimal(0);
    if (fill.side === "BUY")
      costs.set(m.baseAsset, previousCost.plus(qty.mul(price)).plus(quoteFee));
    else {
      if (previousQuantity.lte(0) || qty.plus(baseFee).gt(previousQuantity))
        throw new Error("Allocation sell exceeds managed inventory");
      const removedCost = previousCost.div(previousQuantity).mul(qty.plus(baseFee));
      costs.set(m.baseAsset, previousCost.minus(removedCost));
      realized.set(
        m.baseAsset,
        (realized.get(m.baseAsset) ?? new Decimal(0))
          .plus(qty.mul(price))
          .minus(quoteFee)
          .minus(removedCost)
      );
    }
    total.set(
      m.baseAsset,
      total
        .get(m.baseAsset)!
        .plus(qty.mul(direction))
        .minus(fill.feeAsset === m.baseAsset ? fee : 0)
    );
    total.set(
      policy.quoteAsset,
      total
        .get(policy.quoteAsset)!
        .minus(qty.mul(price).mul(direction))
        .minus(fill.feeAsset === policy.quoteAsset ? fee : 0)
    );
    if ([...total.values()].some((amount) => amount.lt(0)))
      throw new Error("Allocation inventory or capital exhausted");
  }
  const managed = new Map(
    options.managedOrders.map((order) => [order.clientOrderId, order.symbol])
  );
  for (const order of options.openOrders) {
    const m = symbols.get(order.symbol);
    if (!m || managed.get(order.clientOrderId) !== order.symbol)
      throw new Error("Unmanaged exchange order blocks allocated trading");
    const qty = new Decimal(order.origQty).minus(order.executedQty),
      price = new Decimal(order.price);
    if (
      !qty.isFinite() ||
      qty.lt(0) ||
      !price.isFinite() ||
      price.lte(0) ||
      (order.side !== "BUY" && order.side !== "SELL")
    )
      throw new Error("Invalid allocated open order");
    const asset = order.side === "BUY" ? policy.quoteAsset : m.baseAsset;
    locked.set(
      asset,
      (locked.get(asset) ?? new Decimal(0)).plus(order.side === "BUY" ? qty.mul(price) : qty)
    );
  }
  const wallet = new Map<string, BalanceSnapshot>();
  for (const b of options.balances) {
    if (
      wallet.has(b.asset) ||
      !b.free.isFinite() ||
      b.free.lt(0) ||
      !b.locked.isFinite() ||
      b.locked.lt(0)
    )
      throw new Error("Invalid backing balance");
    wallet.set(b.asset, b);
  }
  const balances = [...total].map(([asset, amount]) => {
    const hold = locked.get(asset) ?? new Decimal(0),
      backing = wallet.get(asset);
    if (
      !backing ||
      hold.gt(amount) ||
      backing.free.plus(backing.locked).lt(amount) ||
      backing.free.lt(amount.minus(hold)) ||
      backing.locked.lt(hold)
    )
      throw new Error(`Allocated funding unavailable for ${asset}`);
    if (options.backingBaseline) {
      const baseline = new Decimal(options.backingBaseline[asset] ?? "NaN");
      const expected = baseline
        .plus(amount)
        .minus(asset === policy.quoteAsset ? policy.initialQuote : 0);
      if (!baseline.isFinite() || baseline.lt(0) || !backing.free.plus(backing.locked).eq(expected))
        throw new Error(`Allocated wallet drift for ${asset}; reconciliation required`);
    }
    return { asset, free: amount.minus(hold), locked: hold };
  });
  const positions = new Map(
    [...symbols].map(([symbol, m]) => {
      const quantity = total.get(m.baseAsset)!;
      return [
        symbol,
        {
          symbol,
          quantity,
          avgEntry: quantity.isZero()
            ? new Decimal(0)
            : (costs.get(m.baseAsset) ?? new Decimal(0)).div(quantity),
          realizedPnl: realized.get(m.baseAsset) ?? new Decimal(0)
        }
      ] as const;
    })
  );
  const backingTotals = Object.fromEntries(
    [...total.keys()].map((asset) => [
      asset,
      wallet.get(asset)!.free.plus(wallet.get(asset)!.locked).toFixed()
    ])
  );
  return {
    balances,
    positions,
    backingTotals,
    excludedWalletAssets: [...wallet.keys()].filter((asset) => !total.has(asset)).sort()
  };
}
