import { Decimal } from "decimal.js";

export interface SpotInventory {
  quantity: Decimal;
  cost: Decimal;
  realizedPnl: Decimal;
}

// Weighted-average spot accounting shared by allocated trading and dashboard replay.
export function applySpotFill(
  current: SpotInventory,
  fill: {
    side: "BUY" | "SELL";
    quantity: Decimal;
    price: Decimal;
    fee: Decimal;
    feeAsset: string;
    baseAsset: string;
    quoteAsset: string;
  }
): SpotInventory {
  const { quantity: qty, price, fee } = fill;
  if (
    !qty.isFinite() ||
    qty.lte(0) ||
    !price.isFinite() ||
    price.lte(0) ||
    !fee.isFinite() ||
    fee.lt(0) ||
    !current.quantity.isFinite() ||
    current.quantity.lt(0) ||
    !current.cost.isFinite() ||
    current.cost.lt(0) ||
    !current.realizedPnl.isFinite() ||
    (fill.side !== "BUY" && fill.side !== "SELL")
  )
    throw new Error("invalid_fill");
  if (!fee.isZero() && fill.feeAsset !== fill.baseAsset && fill.feeAsset !== fill.quoteAsset)
    throw new Error("historical_fee_conversion_required");
  const baseFee = fill.feeAsset === fill.baseAsset ? fee : new Decimal(0);
  const quoteFee = fill.feeAsset === fill.quoteAsset ? fee : new Decimal(0);
  if (fill.side === "BUY") {
    const net = qty.minus(baseFee);
    if (net.lte(0)) throw new Error("invalid_net_quantity");
    return {
      quantity: current.quantity.plus(net),
      cost: current.cost.plus(qty.mul(price)).plus(quoteFee),
      realizedPnl: current.realizedPnl
    };
  }
  const removed = qty.plus(baseFee);
  if (current.quantity.isZero() || removed.gt(current.quantity))
    throw new Error("opening_cost_basis_required");
  const removedCost = removed.eq(current.quantity)
    ? current.cost
    : current.cost.mul(removed).div(current.quantity);
  return {
    quantity: current.quantity.minus(removed),
    cost: current.cost.minus(removedCost),
    realizedPnl: current.realizedPnl.plus(qty.mul(price)).minus(quoteFee).minus(removedCost)
  };
}
