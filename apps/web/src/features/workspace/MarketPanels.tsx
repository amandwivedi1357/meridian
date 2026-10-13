import { Decimal } from "decimal.js";
import type { DashboardTrade, BookLevel } from "../../lib/api-client.js";
import { formatTime, formatUsd } from "../../lib/format.js";

export function depthRows(levels: readonly BookLevel[]) {
  let total = new Decimal(0);
  return levels.slice(0, 8).map((level) => {
    total = total.plus(level.quantity);
    return { ...level, total: total.toFixed() };
  });
}
export function MarketPanels({
  book,
  trades,
  baseAsset,
  quoteAsset
}: {
  book: { bids: readonly BookLevel[]; asks: readonly BookLevel[] } | null;
  trades: readonly DashboardTrade[];
  baseAsset: string;
  quoteAsset: string;
}) {
  const bids = depthRows(book?.bids ?? []),
    asks = depthRows(book?.asks ?? []);
  const maximum = Decimal.max(0, ...[...bids, ...asks].map((level) => new Decimal(level.total)));
  const complete = bids.length > 0 && asks.length > 0;
  const spread = complete ? new Decimal(asks[0]!.price).minus(bids[0]!.price) : undefined;
  const mid = complete ? new Decimal(asks[0]!.price).plus(bids[0]!.price).div(2) : undefined;
  const ladder = (rows: ReturnType<typeof depthRows>, side: "bid" | "ask") => (
    <div
      className={`depth-ladder ${side}`}
      role="group"
      aria-label={side === "bid" ? "Bids" : "Asks"}
    >
      {rows.map((level) => (
        <div className="depth-level" key={level.price}>
          <span
            className="depth-fill"
            style={{
              width: `${maximum.gt(0) ? new Decimal(level.total).div(maximum).mul(100).toNumber() : 0}%`
            }}
            aria-hidden="true"
          />
          <span className={side === "bid" ? "positive" : "negative"}>{formatUsd(level.price)}</span>
          <span>{level.quantity}</span>
          <span>{level.total}</span>
        </div>
      ))}
    </div>
  );
  return (
    <>
      <section className="market-data-panel order-depth-panel" aria-labelledby="market-depth-title">
        <header>
          <h2 id="market-depth-title">Order book depth</h2>
          <small>Limited depth</small>
        </header>
        <div className="depth-labels">
          <span>Price / {quoteAsset}</span>
          <span>Amount / {baseAsset}</span>
          <span>Total / {baseAsset}</span>
        </div>
        {complete ? (
          <>
            {ladder(asks.slice().reverse(), "ask")}
            <div className="depth-spread">
              <strong>{formatUsd(mid?.toFixed())}</strong>
              <span>
                Spread <b>{spread?.toFixed(2)}</b> {quoteAsset}
              </span>
            </div>
            {ladder(bids, "bid")}
          </>
        ) : (
          <div className="market-panel-empty">Book unavailable</div>
        )}
      </section>
      <section className="market-data-panel recent-tape-panel" aria-labelledby="market-tape-title">
        <header>
          <h2 id="market-tape-title">Recent trade tape</h2>
          <small>
            {baseAsset} / {quoteAsset}
          </small>
        </header>
        <div className="tape-labels">
          <span>Price / {quoteAsset}</span>
          <span>Amount / {baseAsset}</span>
          <span>Time</span>
        </div>
        <div className="tape-scroll" tabIndex={0} aria-label="Recent trades">
          {trades.length ? (
            trades
              .slice(-30)
              .reverse()
              .map((trade) => (
                <div className="tape-print" key={trade.id}>
                  <span
                    className={trade.side === "buy" ? "positive" : "negative"}
                    title={trade.side}
                  >
                    {formatUsd(trade.price)}
                  </span>
                  <span>{trade.quantity}</span>
                  <time>{formatTime(trade.time)}</time>
                </div>
              ))
          ) : (
            <div className="market-panel-empty">No recent trades</div>
          )}
        </div>
      </section>
    </>
  );
}
