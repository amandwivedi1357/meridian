import { Decimal, projectTestnetAllocation, type TestnetAllocation } from "@meridian/core";
import type { BinanceRestClient, createTestnetTradingClient } from "@meridian/binance-client";
import type { RiskRepository } from "@meridian/db";
import type { RiskFill } from "./risk-accounting.js";
import type { RiskSnapshot } from "./risk-engine.js";

export function createRiskSnapshotReader(options: {
  publicClient: Pick<BinanceRestClient, "getExchangeInfo" | "getDepth">;
  tradingClient: Pick<ReturnType<typeof createTestnetTradingClient>, "getBalances" | "openOrders">;
  repo: Pick<RiskRepository, "listFills">;
  symbols: readonly string[];
  quoteAsset: string;
  nowMs?: () => number;
  assertPortfolioPolicy?: () => Promise<void>;
  allocation?: {
    policy: TestnetAllocation;
    assertPolicy: () => Promise<void>;
    backingBaseline: () => Promise<Record<string, string>>;
    listManagedOrders: () => Promise<readonly { clientOrderId: string; symbol: string }[]>;
  };
}) {
  const now = options.nowMs ?? Date.now;
  return async (): Promise<RiskSnapshot> => {
    // Timestamp at the start, so slow or queued requests cannot look fresh.
    const observedAtMs = now();
    await options.assertPortfolioPolicy?.();
    const info = await options.publicClient.getExchangeInfo();
    let balances = await options.tradingClient.getBalances();
    const openOrders = await options.tradingClient.openOrders();
    const fillRows = await options.repo.listFills();
    if (options.allocation) {
      await options.allocation.assertPolicy();
      if (
        options.allocation.policy.quoteAsset !== options.quoteAsset ||
        options.symbols.some((symbol) => !options.allocation!.policy.symbols.includes(symbol))
      )
        throw new Error("Risk allocation scope mismatch");
      balances = projectTestnetAllocation({
        policy: options.allocation.policy,
        metadata: info.symbols,
        balances,
        openOrders,
        backingBaseline: await options.allocation.backingBaseline(),
        managedOrders: await options.allocation.listManagedOrders(),
        fills: fillRows.map((row) => ({
          symbol: String(row.symbol),
          side: row.side as "BUY" | "SELL",
          quantity: String(row.quantity),
          price: String(row.price),
          fee: String(row.fee),
          feeAsset: String(row.fee_asset),
          eventTimeMs: Number(row.event_time_ms)
        }))
      }).balances;
    }
    const markets = new Map<
      string,
      { mid: Decimal; bid: Decimal; ask: Decimal; observedAtMs: number }
    >();
    const prices = new Map<string, Decimal>([[options.quoteAsset, new Decimal(1)]]);
    const totals = new Map<string, Decimal>();
    for (const balance of balances) {
      const total = balance.free.plus(balance.locked);
      if (!total.isFinite() || total.lt(0)) throw new Error("Invalid account balance");
      totals.set(balance.asset, total);
    }
    async function market(symbol: string) {
      const cached = markets.get(symbol);
      if (cached !== undefined) return cached;
      const at = now();
      const depth = await options.publicClient.getDepth({ symbol, limit: 5 });
      const bid = new Decimal(depth.bids[0]?.[0] ?? "NaN");
      const ask = new Decimal(depth.asks[0]?.[0] ?? "NaN");
      if (!bid.isFinite() || !ask.isFinite() || bid.lte(0) || ask.lt(bid))
        throw new Error("Invalid market book");
      const result = { mid: bid.plus(ask).div(2), bid, ask, observedAtMs: at };
      markets.set(symbol, result);
      return result;
    }
    async function price(asset: string) {
      const cached = prices.get(asset);
      if (cached !== undefined) return cached;
      const direct = info.symbols.find(
        (entry) =>
          entry.baseAsset === asset &&
          entry.quoteAsset === options.quoteAsset &&
          entry.status === "TRADING"
      );
      const inverse = info.symbols.find(
        (entry) =>
          entry.quoteAsset === asset &&
          entry.baseAsset === options.quoteAsset &&
          entry.status === "TRADING"
      );
      if (direct === undefined && inverse === undefined)
        throw new Error(`Risk valuation unavailable for ${asset}`);
      const rate =
        direct !== undefined
          ? (await market(direct.symbol)).mid
          : new Decimal(1).div((await market(inverse!.symbol)).mid);
      prices.set(asset, rate);
      return rate;
    }
    let equity = new Decimal(0);
    let globalExposure = new Decimal(0);
    for (const [asset, total] of totals) {
      if (total.isZero()) continue;
      const value = total.mul(await price(asset));
      equity = equity.plus(value);
      if (asset !== options.quoteAsset) globalExposure = globalExposure.plus(value);
    }
    const positions = new Map<string, Decimal>();
    const pendingBuys = new Map<string, Decimal>();
    const pendingSells = new Map<string, Decimal>();
    for (const order of openOrders) {
      const metadata = info.symbols.find((entry) => entry.symbol === order.symbol);
      if (metadata === undefined) throw new Error("Open order metadata unavailable");
      const remaining = new Decimal(order.origQty).minus(order.executedQty);
      if (!remaining.isFinite() || remaining.lt(0)) throw new Error("Invalid open order quantity");
      const pending = order.side === "BUY" ? pendingBuys : pendingSells;
      pending.set(order.symbol, (pending.get(order.symbol) ?? new Decimal(0)).plus(remaining));
      if (order.side === "BUY") {
        const book = await market(order.symbol);
        const orderPrice = Decimal.max(new Decimal(order.price), book.ask);
        globalExposure = globalExposure.plus(
          remaining.mul(orderPrice).mul(await price(metadata.quoteAsset))
        );
      }
    }
    for (const symbol of options.symbols) {
      const metadata = info.symbols.find(
        (entry) => entry.symbol === symbol && entry.status === "TRADING"
      );
      if (metadata === undefined || metadata.quoteAsset !== options.quoteAsset)
        throw new Error("Unsupported risk trading symbol");
      await market(symbol);
      // A missing balance is unavailable, not an inferred zero position.
      const total = totals.get(metadata.baseAsset);
      if (total === undefined) throw new Error("Position balance unavailable");
      positions.set(symbol, total);
    }
    const fills: RiskFill[] = [];
    for (const row of fillRows) {
      const metadata = info.symbols.find((entry) => entry.symbol === row.symbol);
      if (
        metadata === undefined ||
        typeof row.strategy_id !== "string" ||
        typeof row.fee_asset !== "string" ||
        (row.side !== "BUY" && row.side !== "SELL")
      )
        throw new Error("Risk fill metadata unavailable");
      const eventTimeMs = Number(row.event_time_ms);
      if (!Number.isSafeInteger(eventTimeMs) || eventTimeMs < 0)
        throw new Error("Invalid risk fill timestamp");
      const fee = new Decimal(String(row.fee));
      // Exact historical fee conversion is not present in live fills. Never fabricate it.
      if (
        !fee.isZero() &&
        row.fee_asset !== metadata.baseAsset &&
        row.fee_asset !== options.quoteAsset
      )
        throw new Error("Historical fee valuation unavailable");
      fills.push({
        strategyId: row.strategy_id,
        symbol: metadata.symbol,
        baseAsset: metadata.baseAsset,
        quoteAsset: metadata.quoteAsset,
        side: row.side,
        quantity: new Decimal(String(row.quantity)),
        price: new Decimal(String(row.price)),
        fee,
        feeAsset: row.fee_asset,
        eventTimeMs
      });
    }
    return {
      observedAtMs,
      equity,
      globalExposure,
      positions,
      pendingBuys,
      pendingSells,
      markets,
      openOrderCount: openOrders.length,
      fills,
      assetPrice(asset) {
        const value = prices.get(asset);
        if (value === undefined) throw new Error("Fee valuation unavailable");
        return value;
      }
    };
  };
}
