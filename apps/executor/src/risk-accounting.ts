import { Decimal } from "@meridian/core";

export interface RiskFill {
  strategyId: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  side: "BUY" | "SELL";
  quantity: Decimal;
  price: Decimal;
  fee: Decimal;
  feeAsset: string;
  eventTimeMs: number;
}
export function calculateDailyRealizedPnl(
  fills: readonly RiskFill[],
  nowMs: number,
  quoteAsset: string,
  assetPrice: (asset: string) => Decimal
) {
  const inventory = new Map<string, { quantity: Decimal; cost: Decimal }>();
  const strategyPnl = new Map<string, Decimal>();
  let globalPnl = new Decimal(0);
  const dayStart = Math.floor(nowMs / 86_400_000) * 86_400_000;
  for (const fill of [...fills].sort((a, b) => a.eventTimeMs - b.eventTimeMs)) {
    if (
      fill.quoteAsset !== quoteAsset ||
      fill.eventTimeMs > nowMs ||
      !fill.quantity.isFinite() ||
      fill.quantity.lte(0) ||
      !fill.price.isFinite() ||
      fill.price.lte(0) ||
      !fill.fee.isFinite() ||
      fill.fee.lt(0)
    )
      throw new Error("Invalid risk fill");
    const key = `${fill.strategyId}:${fill.symbol}`;
    const current = inventory.get(key) ?? { quantity: new Decimal(0), cost: new Decimal(0) };
    const baseFee = fill.feeAsset === fill.baseAsset ? fill.fee : new Decimal(0);
    const otherFee =
      baseFee.isZero() && !fill.fee.isZero()
        ? fill.fee.mul(assetPrice(fill.feeAsset))
        : new Decimal(0);
    if (fill.side === "BUY") {
      const net = fill.quantity.minus(baseFee);
      if (net.lte(0)) throw new Error("Invalid net fill quantity");
      inventory.set(key, {
        quantity: current.quantity.plus(net),
        cost: current.cost.plus(fill.quantity.mul(fill.price)).plus(otherFee)
      });
    } else {
      const removed = fill.quantity.plus(baseFee);
      if (removed.gt(current.quantity) || current.quantity.isZero())
        throw new Error("Realized PnL cost basis unavailable");
      const cost = current.cost.mul(removed).div(current.quantity);
      const pnl = fill.quantity.mul(fill.price).minus(otherFee).minus(cost);
      inventory.set(key, {
        quantity: current.quantity.minus(removed),
        cost: current.cost.minus(cost)
      });
      if (fill.eventTimeMs >= dayStart) {
        globalPnl = globalPnl.plus(pnl);
        strategyPnl.set(
          fill.strategyId,
          (strategyPnl.get(fill.strategyId) ?? new Decimal(0)).plus(pnl)
        );
      }
    }
  }
  return { globalPnl, strategyPnl };
}
