import { Decimal, type Fill, type Position } from "@meridian/core";

export interface SimBrokerState {
  readonly quoteBalance: Decimal;
  readonly position: Position;
}

export function applyFill(state: SimBrokerState, fill: Fill, quoteAsset: string): SimBrokerState {
  const position = state.position;
  if (fill.symbol !== position.symbol || fill.feeAsset !== quoteAsset) {
    throw new Error("Fill does not match broker assets");
  }

  const notional = fill.price.times(fill.quantity);

  if (fill.side === "BUY") {
    const cost = notional.plus(fill.fee);
    if (cost.gt(state.quoteBalance)) {
      throw new Error("Insufficient quote balance");
    }

    const quantity = position.quantity.plus(fill.quantity);
    const costBasis = position.avgEntry.times(position.quantity).plus(cost);

    return {
      quoteBalance: state.quoteBalance.minus(cost),
      position: {
        ...position,
        quantity,
        avgEntry: costBasis.div(quantity)
      }
    };
  }

  if (fill.quantity.gt(position.quantity)) {
    throw new Error("Insufficient base balance");
  }

  const proceeds = notional.minus(fill.fee);
  const quantity = position.quantity.minus(fill.quantity);
  const realized = proceeds.minus(position.avgEntry.times(fill.quantity));

  return {
    quoteBalance: state.quoteBalance.plus(proceeds),
    position: {
      ...position,
      quantity,
      avgEntry: quantity.isZero() ? new Decimal(0) : position.avgEntry,
      realizedPnl: position.realizedPnl.plus(realized)
    }
  };
}
