import { Decimal, isSignalExpired, type Signal } from "@meridian/core";
import type { LockedRiskRepository, RiskRepository } from "@meridian/db";
import type { RiskDecision } from "./signal-execution.js";
import type { KillSwitch } from "./kill-switch.js";
import type { RiskConfig } from "./risk-config.js";
import { calculateDailyRealizedPnl, type RiskFill } from "./risk-accounting.js";

export interface RiskSnapshot {
  observedAtMs: number;
  equity: Decimal;
  globalExposure: Decimal;
  positions: ReadonlyMap<string, Decimal>;
  pendingBuys?: ReadonlyMap<string, Decimal>;
  pendingSells?: ReadonlyMap<string, Decimal>;
  markets: ReadonlyMap<
    string,
    { mid: Decimal; bid?: Decimal; ask?: Decimal; observedAtMs: number }
  >;
  openOrderCount: number;
  fills: readonly RiskFill[];
  assetPrice: (asset: string) => Decimal;
}
export function createRiskEngine(options: {
  repo: RiskRepository;
  killSwitch: KillSwitch;
  config: RiskConfig;
  snapshot: () => Promise<RiskSnapshot>;
  assertReady: () => Promise<void>;
  nowMs?: () => number;
  assertPortfolioPolicy?: () => Promise<void>;
}) {
  const now = options.nowMs ?? Date.now;
  function validateSnapshot(snapshot: RiskSnapshot) {
    const age = now() - snapshot.observedAtMs;
    if (
      !Number.isSafeInteger(snapshot.observedAtMs) ||
      age < 0 ||
      age > options.config.maxDataAgeMs
    )
      throw new Error("risk-state-stale");
    if (
      !snapshot.equity.isFinite() ||
      snapshot.equity.lte(0) ||
      !snapshot.globalExposure.isFinite() ||
      snapshot.globalExposure.lt(0) ||
      !Number.isSafeInteger(snapshot.openOrderCount) ||
      snapshot.openOrderCount < 0
    )
      throw new Error("risk-state-invalid");
    for (const positions of [snapshot.positions, snapshot.pendingBuys, snapshot.pendingSells]) {
      for (const quantity of positions?.values() ?? []) {
        if (!quantity.isFinite() || quantity.lt(0)) throw new Error("risk-position-state-invalid");
      }
    }
  }
  async function breakers(
    repo: LockedRiskRepository,
    snapshot: RiskSnapshot
  ): Promise<string | undefined> {
    await options.assertPortfolioPolicy?.();
    validateSnapshot(snapshot);
    const peak = new Decimal(
      await repo.updatePeak(snapshot.equity.toFixed(), options.config.quoteAsset)
    );
    if (!peak.isFinite() || peak.lt(snapshot.equity) || peak.lte(0))
      throw new Error("Equity peak invalid");
    const pnl = calculateDailyRealizedPnl(
      snapshot.fills,
      now(),
      options.config.quoteAsset,
      snapshot.assetPrice
    );
    if (pnl.globalPnl.lte(options.config.globalDailyLoss.neg())) return "daily-loss-global";
    for (const [strategyId, realized] of pnl.strategyPnl) {
      if (realized.lte(options.config.strategy(strategyId).dailyLoss.neg()))
        return `daily-loss-strategy:${strategyId}`;
    }
    if (peak.minus(snapshot.equity).div(peak).gte(options.config.maxDrawdown))
      return "maximum-drawdown";
    return undefined;
  }
  async function latch(repo: LockedRiskRepository, reason: string) {
    await repo.setKillState(true, reason, "risk-breaker");
    await repo.recordEvent("risk-breaker", { reason });
  }
  async function monitor() {
    if (await options.killSwitch.check()) return;
    try {
      await options.assertReady();
      const snapshot = await options.snapshot();
      const reason = await options.repo.locked(async (repo) => {
        if ((await repo.getKillState()).engaged) return "kill-switch-engaged";
        const reason = await breakers(repo, snapshot);
        if (reason !== undefined) await latch(repo, reason);
        return reason;
      });
      if (reason !== undefined) await options.killSwitch.engage(reason);
    } catch {
      await options.killSwitch.engage("risk-monitor-unavailable");
    }
  }
  return {
    monitor,
    async evaluate(signal: Signal): Promise<RiskDecision> {
      let reason: string | undefined;
      let breaker = false;
      try {
        if (await options.killSwitch.check()) reason = "kill-switch-engaged";
        else {
          await options.assertReady();
          const snapshot = await options.snapshot();
          const result = await options.repo.locked(async (repo) => {
            if ((await repo.getKillState()).engaged)
              return { reason: "kill-switch-engaged", breaker: false };
            const trip = await breakers(repo, snapshot);
            if (trip !== undefined) {
              await latch(repo, trip);
              return { reason: trip, breaker: true };
            }
            if (isSignalExpired(signal, now())) return { reason: "signal-expired", breaker: false };
            const intent = signal.intent;
            const limits = options.config.symbol(intent.symbol);
            const market = snapshot.markets.get(intent.symbol);
            if (
              market === undefined ||
              !market.mid.isFinite() ||
              market.mid.lte(0) ||
              !Number.isSafeInteger(market.observedAtMs) ||
              now() < market.observedAtMs ||
              now() - market.observedAtMs > options.config.maxDataAgeMs
            )
              throw new Error("market-data-unavailable-or-stale");
            const price =
              intent.limitPrice ?? (intent.side === "BUY" ? market.ask : market.bid) ?? market.mid;
            const notional = price.mul(intent.quantity);
            const reject = (reason: string) => ({ reason, breaker: false });
            if (
              !price.isFinite() ||
              price.lte(0) ||
              !intent.quantity.isFinite() ||
              intent.quantity.lte(0)
            )
              return reject("invalid-order-values");
            if (price.minus(market.mid).abs().div(market.mid).gt(limits.maxPriceDeviation))
              return reject("price-sanity-deviation");
            if (notional.lt(limits.minNotional)) return reject("notional-below-minimum");
            if (notional.gt(limits.maxNotional)) return reject("notional-above-limit");
            if (intent.quantity.gt(limits.maxQuantity)) return reject("quantity-above-limit");
            const allReservations = await repo.listActiveReservations(now());
            const existing = allReservations.find((row) => row.signal_id === signal.signalId);
            if (existing !== undefined) {
              if (
                existing.strategy_id !== signal.strategyId ||
                existing.symbol !== intent.symbol ||
                existing.side !== intent.side ||
                !new Decimal(String(existing.quantity)).eq(intent.quantity)
              )
                return reject("reservation-identity-conflict");
            }
            const reservations = allReservations.filter((row) => row !== existing);
            if (
              existing === undefined &&
              (await repo.countRecentReservations(signal.strategyId, now())) >=
                options.config.strategy(signal.strategyId).ordersPerMinute
            )
              return reject("orders-per-minute-limit");
            if (snapshot.openOrderCount + reservations.length >= options.config.maxOpenOrders)
              return reject("open-orders-at-limit");
            const position = snapshot.positions.get(intent.symbol);
            if (position === undefined || !position.isFinite() || position.lt(0))
              throw new Error("position-unavailable");
            let reservedBuyQuantity = new Decimal(0);
            let reservedSellQuantity = new Decimal(0);
            let reservedNotional = new Decimal(0);
            for (const row of reservations) {
              const quantity = new Decimal(String(row.quantity));
              const reserved = new Decimal(String(row.notional));
              if (
                !quantity.isFinite() ||
                quantity.lte(0) ||
                !reserved.isFinite() ||
                reserved.lte(0) ||
                (row.side !== "BUY" && row.side !== "SELL")
              )
                throw new Error("reservation-invalid");
              if (row.side === "BUY") reservedNotional = reservedNotional.plus(reserved);
              if (row.symbol === intent.symbol) {
                if (row.side === "BUY") reservedBuyQuantity = reservedBuyQuantity.plus(quantity);
                else reservedSellQuantity = reservedSellQuantity.plus(quantity);
              }
            }
            if (
              intent.side === "SELL" &&
              intent.quantity
                .plus(reservedSellQuantity)
                .plus(snapshot.pendingSells?.get(intent.symbol) ?? 0)
                .gt(position)
            )
              return reject("insufficient-position");
            const projected = position
              .plus(snapshot.pendingBuys?.get(intent.symbol) ?? 0)
              .plus(reservedBuyQuantity)
              .plus(intent.side === "BUY" ? intent.quantity : new Decimal(0));
            if (projected.gt(limits.maxPosition)) return reject("position-above-limit");
            if (projected.mul(market.mid).gt(limits.maxExposure))
              return reject("symbol-exposure-above-limit");
            const projectedGlobal = snapshot.globalExposure
              .plus(reservedNotional)
              .plus(intent.side === "BUY" ? notional : new Decimal(0));
            if (projectedGlobal.gt(options.config.maxGlobalExposure))
              return reject("global-exposure-above-limit");
            if (existing === undefined)
              await repo.reserve({
                signalId: signal.signalId,
                strategyId: signal.strategyId,
                symbol: intent.symbol,
                side: intent.side,
                quantity: intent.quantity.toFixed(),
                notional: notional.toFixed(),
                reservedAtMs: now(),
                validUntilMs: signal.validUntilMs
              });
            return { reason: undefined, breaker: false };
          });
          reason = result.reason;
          breaker = result.breaker;
        }
      } catch (error) {
        reason = `risk-check-error:${error instanceof Error ? error.message : "unavailable"}`;
        try {
          await options.killSwitch.engage("risk-critical-dependency-unavailable");
        } catch {
          /* Keep the rejection even if control persistence failed. */
        }
      }
      if (breaker) {
        try {
          await options.killSwitch.engage(reason ?? "risk-breaker");
        } catch {
          /* Durable breaker already blocks execution. */
        }
      }
      // Signal handling owns rejection persistence before acknowledging the message.
      return reason === undefined ? { approved: true } : { approved: false, reason };
    }
  };
}
