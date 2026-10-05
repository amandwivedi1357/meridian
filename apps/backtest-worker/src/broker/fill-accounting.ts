import { Decimal, type Fill, type Position } from "@meridian/core";

export interface SimBrokerState {
  readonly quoteBalance: Decimal;
  readonly position: Position;
  readonly feeBalances: ReadonlyMap<string, Decimal>;
}

function deductExternalFeeBalance(
  balances: ReadonlyMap<string, Decimal>,
  feeAsset: string,
  fee: Decimal
): ReadonlyMap<string, Decimal> {
  const current = balances.get(feeAsset);
  if (current === undefined) return balances;

  const next = new Map(balances);
  next.set(feeAsset, current.minus(fee));
  return next;
}

export function applyFill(
  state: SimBrokerState,
  fill: Fill,
  quoteAsset: string,
  baseAsset: string
): SimBrokerState {
  const position = state.position;
  if (fill.symbol !== position.symbol) {
    throw new Error("Fill does not match broker symbol");
  }

  const feeInQuote = fill.feeAsset === quoteAsset;
  const feeInBase = fill.feeAsset === baseAsset;
  const feeInExternal = !feeInQuote && !feeInBase;

  if (feeInExternal) {
    const externalFeeBalance = state.feeBalances.get(fill.feeAsset);
    if (externalFeeBalance === undefined) {
      throw new Error("Unsupported fee asset");
    }

    if (externalFeeBalance.lt(fill.fee)) {
      throw new Error(`Insufficient ${fill.feeAsset} fee balance`);
    }
  }

  const notional = fill.price.times(fill.quantity);

  if (fill.side === "BUY") {
    const quoteCost = feeInQuote ? notional.plus(fill.fee) : notional;
    if (quoteCost.gt(state.quoteBalance)) {
      throw new Error("Insufficient quote balance");
    }

    const receivedQuantity = feeInBase ? fill.quantity.minus(fill.fee) : fill.quantity;
    if (receivedQuantity.lte(0)) {
      throw new Error("Base fee exceeds bought quantity");
    }

    const quantity = position.quantity.plus(receivedQuantity);
    const costBasis = position.avgEntry.times(position.quantity).plus(quoteCost);

    return {
      quoteBalance: state.quoteBalance.minus(quoteCost),
      feeBalances: feeInExternal
        ? deductExternalFeeBalance(state.feeBalances, fill.feeAsset, fill.fee)
        : state.feeBalances,
      position: {
        ...position,
        quantity,
        avgEntry: costBasis.div(quantity)
      }
    };
  }

  const baseQuantityRemoved = feeInBase ? fill.quantity.plus(fill.fee) : fill.quantity;

  if (baseQuantityRemoved.gt(position.quantity)) {
    throw new Error("Insufficient base balance");
  }

  const proceeds = feeInQuote ? notional.minus(fill.fee) : notional;
  const quantity = position.quantity.minus(baseQuantityRemoved);
  const realized = proceeds.minus(position.avgEntry.times(baseQuantityRemoved));

  return {
    quoteBalance: state.quoteBalance.plus(proceeds),
    feeBalances: feeInExternal
      ? deductExternalFeeBalance(state.feeBalances, fill.feeAsset, fill.fee)
      : state.feeBalances,
    position: {
      ...position,
      quantity,
      avgEntry: quantity.isZero() ? new Decimal(0) : position.avgEntry,
      realizedPnl: position.realizedPnl.plus(realized)
    }
  };
}
