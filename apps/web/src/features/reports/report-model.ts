import { Decimal } from "decimal.js";
import type { FillRecord, Portfolio } from "../../lib/api-client.js";
export const STARTING_BALANCE = new Decimal(100);
export const QUOTE_ASSET = "USDT";
export interface BalancePoint {
  id: string;
  time: number;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: string;
  price: string;
  cash: string;
  positionValue: string;
  equity: string;
  pnl: string;
  fee: string;
  feeAsset: string;
}
export function reportMarks(
  positions: readonly Pick<Portfolio["positions"][number], "symbol" | "markPrice">[],
  trade?: { symbol: string; price: string }
) {
  const marks = new Map<string, string>();
  for (const position of positions)
    if (position.markPrice) marks.set(position.symbol, position.markPrice);
  if (trade) marks.set(trade.symbol, trade.price);
  return marks;
}
export function buildBalanceReport(
  fills: readonly FillRecord[],
  liveMarks: ReadonlyMap<string, string>,
  complete: boolean
) {
  if (!complete) return null;
  try {
    let cash = STARTING_BALANCE;
    const holdings = new Map<string, Decimal>(),
      marks = new Map<string, string>();
    const points: BalancePoint[] = [];
    for (const fill of fills
      .slice()
      .sort(
        (a, b) => a.eventTimeMs - b.eventTimeMs || a.executionId.localeCompare(b.executionId)
      )) {
      const quantity = new Decimal(fill.quantity),
        price = new Decimal(fill.price),
        fee = new Decimal(fill.fee);
      const base = fill.symbol.slice(0, -QUOTE_ASSET.length);
      if (
        !fill.symbol.endsWith(QUOTE_ASSET) ||
        !quantity.isFinite() ||
        !quantity.gt(0) ||
        !price.isFinite() ||
        !price.gt(0) ||
        !fee.isFinite() ||
        fee.lt(0) ||
        (fee.gt(0) && fill.feeAsset !== QUOTE_ASSET && fill.feeAsset !== base)
      )
        return null;
      const previous = holdings.get(fill.symbol) ?? new Decimal(0);
      const next = fill.side === "BUY" ? previous.plus(quantity) : previous.minus(quantity);
      const holding = next.minus(fill.feeAsset === base ? fee : 0);
      if (holding.lt(0)) return null; // A missing opening holding cannot be invented as a short.
      holdings.set(fill.symbol, holding);
      cash = fill.side === "BUY" ? cash.minus(quantity.mul(price)) : cash.plus(quantity.mul(price));
      if (fill.feeAsset === QUOTE_ASSET) cash = cash.minus(fee);
      if (cash.lt(0)) return null;
      marks.set(fill.symbol, fill.price);
      const positionValue = valueHoldings(holdings, marks),
        equity = cash.plus(positionValue);
      points.push({
        id: `${fill.clientOrderId}:${fill.executionId}`,
        time: fill.eventTimeMs,
        symbol: fill.symbol,
        side: fill.side,
        quantity: fill.quantity,
        price: fill.price,
        cash: cash.toFixed(8),
        positionValue: positionValue.toFixed(8),
        equity: equity.toFixed(8),
        pnl: equity.minus(STARTING_BALANCE).toFixed(8),
        fee: fill.fee,
        feeAsset: fill.feeAsset
      });
    }
    for (const [symbol, quantity] of holdings)
      if (quantity.gt(0)) {
        const mark = liveMarks.get(symbol);
        if (!mark || !new Decimal(mark).isFinite() || !new Decimal(mark).gt(0)) return null;
        marks.set(symbol, mark);
      }
    const positionValue = valueHoldings(holdings, marks),
      equity = cash.plus(positionValue),
      pnl = equity.minus(STARTING_BALANCE);
    return {
      points,
      cash: cash.toFixed(8),
      positionValue: positionValue.toFixed(8),
      equity: equity.toFixed(8),
      pnl: pnl.toFixed(8),
      returnPct: pnl.div(STARTING_BALANCE).mul(100).toFixed(4),
      holdings: [...holdings].filter(([, q]) => q.gt(0)).map(([s, q]) => [s, q.toFixed(8)] as const)
    };
  } catch {
    return null;
  }
}
function valueHoldings(holdings: ReadonlyMap<string, Decimal>, marks: ReadonlyMap<string, string>) {
  let value = new Decimal(0);
  for (const [symbol, quantity] of holdings)
    if (quantity.gt(0)) value = value.plus(quantity.mul(marks.get(symbol)!));
  return value;
}
