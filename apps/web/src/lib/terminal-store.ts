import { create } from "zustand";
import { Decimal } from "decimal.js";
import type { SystemHealth } from "../features/dashboard/health-model.js";
import type {
  BookLevel,
  DashboardTrade,
  MarketCandle,
  MarketEvent,
  MarketSnapshot,
  Principal,
  TradingState
} from "./api-client.js";

export type Connection = "connecting" | "live" | "reconnecting" | "unavailable";
export interface MarketState {
  candles: MarketCandle[];
  trades: DashboardTrade[];
  book: { bids: BookLevel[]; asks: BookLevel[]; lastUpdateId: number } | null;
  updatedAt: number | null;
}
const emptyMarket = (): MarketState => ({ candles: [], trades: [], book: null, updatedAt: null });
const emptyTransport = () => ({
  market: { reconnects: 0, lastReceivedAt: null as number | null },
  account: { reconnects: 0, lastReceivedAt: null as number | null }
});
export const useTerminalStore = create<{
  principal: Principal | null;
  session: "checking" | "ready" | "required" | "unavailable";
  market: MarketState;
  account: TradingState | null;
  marketConnection: Connection;
  accountConnection: Connection;
  health: SystemHealth | null;
  transport: ReturnType<typeof emptyTransport>;
  setSession: (
    principal: Principal | null,
    session: "checking" | "ready" | "required" | "unavailable"
  ) => void;
  reset: () => void;
}>((set) => ({
  principal: null,
  session: "checking",
  market: emptyMarket(),
  account: null,
  marketConnection: "connecting",
  accountConnection: "connecting",
  health: null,
  transport: emptyTransport(),
  setSession: (principal, session) =>
    set({
      principal,
      session,
      ...(session !== "ready"
        ? {
            market: emptyMarket(),
            account: null,
            health: null,
            transport: emptyTransport(),
            marketConnection: "unavailable" as const,
            accountConnection: "unavailable" as const
          }
        : {})
    }),
  reset: () =>
    set({
      market: emptyMarket(),
      account: null,
      health: null,
      transport: emptyTransport(),
      marketConnection: "connecting",
      accountConnection: "connecting"
    })
}));

function number(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("invalid_timestamp");
}
function amount(value: unknown, zero = true): string {
  if (typeof value !== "string" || value.length > 128) throw new Error("invalid_amount");
  const d = new Decimal(value);
  if (
    !d.isFinite() ||
    d.lt(0) ||
    d.gt("1e30") ||
    (!d.isZero() && d.lt("1e-30")) ||
    (!zero && d.isZero())
  )
    throw new Error("invalid_amount");
  return d.toFixed();
}
function levels(value: BookLevel[]): BookLevel[] {
  if (!Array.isArray(value) || value.length > 1000) throw new Error("invalid_book");
  return value.map((l) => ({ price: amount(l.price, false), quantity: amount(l.quantity) }));
}
function trade(value: MarketSnapshot["trades"][number]): DashboardTrade {
  if (
    value.symbol !== "BTCUSDT" ||
    typeof value.tradeId !== "string" ||
    typeof value.isBuyerMaker !== "boolean"
  )
    throw new Error("invalid_trade");
  number(value.eventTimeMs);
  return {
    id: value.tradeId,
    time: value.eventTimeMs,
    price: amount(value.price, false),
    quantity: amount(value.quantity, false),
    side: value.isBuyerMaker ? "sell" : "buy"
  };
}
function candle(value: MarketCandle, interval: string): MarketCandle {
  if (
    value.symbol !== "BTCUSDT" ||
    value.interval !== interval ||
    typeof value.closed !== "boolean"
  )
    throw new Error("invalid_candle");
  number(value.openTimeMs);
  number(value.closeTimeMs);
  const result = {
    ...value,
    open: amount(value.open, false),
    high: amount(value.high, false),
    low: amount(value.low, false),
    close: amount(value.close, false),
    volume: amount(value.volume)
  };
  if (
    value.closeTimeMs < value.openTimeMs ||
    new Decimal(result.low).gt(result.high) ||
    new Decimal(result.open).lt(result.low) ||
    new Decimal(result.close).gt(result.high) ||
    new Decimal(result.open).gt(result.high) ||
    new Decimal(result.close).lt(result.low)
  )
    throw new Error("invalid_candle");
  return result;
}
function sorted(rows: BookLevel[], bids: boolean): BookLevel[] {
  return rows
    .filter((l) => !new Decimal(l.quantity).isZero())
    .sort((a, b) => new Decimal(a.price).cmp(b.price) * (bids ? -1 : 1));
}
function checkBook(book: NonNullable<MarketState["book"]>) {
  if (
    !book.bids.length ||
    !book.asks.length ||
    book.bids.length > 500 ||
    book.asks.length > 500 ||
    new Decimal(book.bids[0]!.price).gte(book.asks[0]!.price)
  )
    throw new Error("book_resync_required");
}
export function marketFromSnapshot(snapshot: MarketSnapshot, interval: string): MarketState {
  if (
    snapshot.symbol !== "BTCUSDT" ||
    snapshot.interval !== interval ||
    !snapshot.cursor ||
    snapshot.trades.length > 200 ||
    snapshot.candles.length > 200
  )
    throw new Error("invalid_snapshot");
  number(snapshot.book.lastUpdateId);
  number(snapshot.book.eventTimeMs);
  const book = {
    bids: sorted(levels(snapshot.book.bids), true),
    asks: sorted(levels(snapshot.book.asks), false),
    lastUpdateId: snapshot.book.lastUpdateId
  };
  checkBook(book);
  return {
    book,
    updatedAt: snapshot.book.eventTimeMs,
    trades: [
      ...new Map(
        snapshot.trades.map((t) => {
          const row = trade(t);
          return [row.id, row] as const;
        })
      ).values()
    ].slice(-200),
    candles: [
      ...new Map(snapshot.candles.map((c) => [c.openTimeMs, candle(c, interval)] as const)).values()
    ].sort((a, b) => a.openTimeMs - b.openTimeMs)
  };
}
export function reduceMarket(
  state: MarketState,
  events: MarketEvent[],
  interval: string,
  now = Date.now()
): MarketState {
  if (!Array.isArray(events) || events.length > 1000) throw new Error("invalid_batch");
  let next = { ...state, book: state.book ? { ...state.book } : null };
  for (const event of events) {
    number(event.occurredAtMs);
    if (
      event.symbol !== "BTCUSDT" ||
      event.occurredAtMs > now + 5000 ||
      now - event.occurredAtMs > 15000
    )
      throw new Error("stale_market_batch");
    if (event.kind === "trade") {
      const row = trade(event.trade);
      next.trades = [...next.trades.filter((t) => t.id !== row.id), row].slice(-200);
    } else if (event.kind === "kline") {
      const row = candle(event.candle, interval);
      next.candles = [...next.candles.filter((c) => c.openTimeMs !== row.openTimeMs), row]
        .sort((a, b) => a.openTimeMs - b.openTimeMs)
        .slice(-200);
    } else if (event.kind === "depth") {
      const book = next.book;
      if (!book) throw new Error("book_bootstrap_required");
      number(event.depth.firstUpdateId);
      number(event.depth.finalUpdateId);
      if (event.depth.finalUpdateId < event.depth.firstUpdateId)
        throw new Error("invalid_book_update");
      if (event.depth.finalUpdateId <= book.lastUpdateId) continue;
      if (event.depth.firstUpdateId > book.lastUpdateId + 1) throw new Error("book_gap");
      const merge = (current: BookLevel[], updates: BookLevel[], bid: boolean) => {
        const rows = new Map(current.map((l) => [l.price, l]));
        for (const l of levels(updates)) {
          if (new Decimal(l.quantity).isZero()) rows.delete(l.price);
          else rows.set(l.price, l);
        }
        return sorted([...rows.values()], bid);
      };
      next.book = {
        bids: merge(book.bids, event.depth.bids, true),
        asks: merge(book.asks, event.depth.asks, false),
        lastUpdateId: event.depth.finalUpdateId
      };
      checkBook(next.book);
    } else throw new Error("invalid_market_kind");
    next.updatedAt = Math.max(next.updatedAt ?? 0, event.occurredAtMs);
  }
  return next;
}
export function parseAccount(value: unknown): TradingState {
  if (!value || typeof value !== "object") throw new Error("invalid_account");
  const a = value as TradingState;
  const checkedAt = a.checkedAt ?? a.portfolio?.checkedAt;
  number(checkedAt);
  for (const key of ["orders", "fills", "riskEvents", "strategies"] as const)
    if (!Array.isArray(a[key]) || a[key].length > 100) throw new Error("invalid_account");
  if (a.riskControl !== null && (!a.riskControl || typeof a.riskControl.engaged !== "boolean"))
    throw new Error("invalid_account");
  if (
    !a.portfolio ||
    !Array.isArray(a.portfolio.positions) ||
    a.portfolio.positions.length > 5 ||
    !Array.isArray(a.portfolio.totals)
  )
    throw new Error("invalid_portfolio");
  if (a.portfolio.equity !== null) amount(a.portfolio.equity);
  const text = (v: unknown) => {
    if (typeof v !== "string" || v.length > 4096) throw new Error("invalid_account_field");
  };
  const signed = (v: unknown) => {
    if (v === null) return;
    if (typeof v !== "string" || v.length > 128) throw new Error("invalid_account_amount");
    const d = new Decimal(v);
    if (!d.isFinite() || d.abs().gt("1e30") || (!d.isZero() && d.abs().lt("1e-30")))
      throw new Error("invalid_account_amount");
  };
  for (const o of a.orders) {
    text(o.symbol);
    text(o.side);
    text(o.state);
    number(o.updatedAtMs);
    amount(o.quantity);
    amount(o.executedQuantity);
    if (o.limitPrice !== null) amount(o.limitPrice);
  }
  for (const f of a.fills) {
    text(f.symbol);
    text(f.side);
    text(f.feeAsset);
    number(f.eventTimeMs);
    amount(f.quantity);
    amount(f.price);
    amount(f.fee);
  }
  for (const r of a.riskEvents) {
    number(r.tsMs);
    text(r.type);
  }
  for (const s of a.strategies) {
    text(s.strategyId);
    text(s.reason);
    if (typeof s.paused !== "boolean") throw new Error("invalid_strategy");
  }
  if (a.riskControl) text(a.riskControl.reason);
  for (const p of a.portfolio.positions) {
    text(p.symbol);
    text(p.status);
    if (p.reason !== null) text(p.reason);
    for (const key of [
      "quantity",
      "avgEntry",
      "markPrice",
      "realizedPnl",
      "unrealizedPnl"
    ] as const)
      signed(p[key]);
  }
  if (a.portfolio.totals.length > 5) throw new Error("invalid_portfolio");
  for (const t of a.portfolio.totals) {
    text(t.quoteAsset);
    signed(t.realizedPnl);
    signed(t.unrealizedPnl);
  }
  if (a.portfolio.equityReason !== null) text(a.portfolio.equityReason);
  if (a.portfolio.wallet) {
    text(a.portfolio.wallet.status);
    text(a.portfolio.wallet.reconciliation);
  }
  return { ...a, checkedAt };
}
