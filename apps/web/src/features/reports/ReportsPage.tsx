import { Decimal } from "decimal.js";
import { Activity, ArrowDownRight, ArrowUpRight, CircleDollarSign, Wallet } from "lucide-react";
import { DataTable } from "../../components/terminal/DataTable.js";
import { StatusBadge } from "../../components/terminal/StatusBadge.js";
import type { FillRecord } from "../../lib/api-client.js";
import { formatSignedUsd, formatTime, formatUsd } from "../../lib/format.js";
import { useTerminalStore } from "../../lib/terminal-store.js";

const STARTING_BALANCE = new Decimal(100);
const QUOTE_ASSET = "USDT";

interface BalancePoint {
  readonly id: string;
  readonly time: number;
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: string;
  readonly price: string;
  readonly cash: string;
  readonly positionValue: string;
  readonly equity: string;
  readonly pnl: string;
  readonly fee: string;
  readonly feeAsset: string;
}

interface ReportModel {
  readonly points: readonly BalancePoint[];
  readonly cash: string;
  readonly positionValue: string;
  readonly equity: string;
  readonly pnl: string;
  readonly returnPct: string | null;
  readonly holdings: readonly [string, string][];
}

export function ReportsPage() {
  const { account, market, accountConnection, transport } = useTerminalStore();
  const accountFresh =
    !!account &&
    transport.account.lastReceivedAt !== null &&
    Date.now() - transport.account.lastReceivedAt <= 45000;
  const selectedSymbol =
    account?.portfolio?.positions.find((position) => position.symbol)?.symbol ??
    account?.fills[0]?.symbol ??
    "BTCUSDT";
  const markPrices = new Map<string, string>();
  const selectedPosition = account?.portfolio?.positions.find(
    (position) => position.symbol === selectedSymbol
  );
  const latestTrade = market.trades.at(-1);
  if (selectedPosition?.markPrice) markPrices.set(selectedSymbol, selectedPosition.markPrice);
  if (latestTrade?.price) markPrices.set(selectedSymbol, latestTrade.price);
  const report = buildBalanceReport(account?.fills ?? [], markPrices);
  const lastPoint = report.points.at(-1);
  return (
    <main className="reports-page">
      <header className="reports-heading">
        <div>
          <span>Performance / live ledger</span>
          <h1>Trading report</h1>
          <p>
            Running equity from {STARTING_BALANCE.toFixed(2)} {QUOTE_ASSET} start capital,
            reconstructed from persisted fills and live mark prices.
          </p>
        </div>
        <StatusBadge tone={accountFresh && accountConnection === "live" ? "green" : "amber"}>
          {accountFresh ? accountConnection : "account stale"}
        </StatusBadge>
      </header>
      <section className="report-hero">
        <div className="report-equity-card">
          <div className="report-card-label">
            <Wallet size={16} />
            Current equity
          </div>
          <strong className={toneForValue(report.pnl)}>{formatUsd(report.equity)}</strong>
          <span className={toneForValue(report.pnl)}>
            {formatSignedUsd(report.pnl)} / {formatPercent(report.returnPct)}
          </span>
        </div>
        <div className="report-metric-card">
          <span>Start balance</span>
          <strong>
            {STARTING_BALANCE.toFixed(2)} {QUOTE_ASSET}
          </strong>
        </div>
        <div className="report-metric-card">
          <span>Cash balance</span>
          <strong>{formatUsd(report.cash)}</strong>
        </div>
        <div className="report-metric-card">
          <span>Position value</span>
          <strong>{formatUsd(report.positionValue)}</strong>
        </div>
        <div className="report-metric-card">
          <span>Fills counted</span>
          <strong>{report.points.length}</strong>
        </div>
      </section>
      <section className="report-grid">
        <div className="report-panel report-chart-panel">
          <div className="panel-title">
            <h2>Running balance curve</h2>
            <small>{lastPoint ? `Last fill ${formatTime(lastPoint.time)}` : "No fills yet"}</small>
          </div>
          <BalanceCurve points={report.points} />
          <div className="balance-step-strip">
            {report.points.slice(-6).map((point) => (
              <div key={point.id}>
                <span>{formatTime(point.time)}</span>
                <strong className={toneForValue(point.pnl)}>{formatUsd(point.equity)}</strong>
              </div>
            ))}
            {!report.points.length && (
              <div className="terminal-empty compact">No fills to plot</div>
            )}
          </div>
        </div>
        <div className="report-panel">
          <div className="panel-title">
            <h2>Balance explanation</h2>
            <small>Simple accounting</small>
          </div>
          <div className="report-explainer">
            <div>
              <CircleDollarSign size={16} />
              <p>
                BUY converts {QUOTE_ASSET} cash into coin holding. Equity should stay near flat
                until price moves.
              </p>
            </div>
            <div>
              <Activity size={16} />
              <p>
                SELL converts coin back into {QUOTE_ASSET}. Profit/loss becomes obvious in the
                running equity line.
              </p>
            </div>
            <div>
              {new Decimal(report.pnl).gte(0) ? (
                <ArrowUpRight size={16} />
              ) : (
                <ArrowDownRight size={16} />
              )}
              <p>
                Current result is start balance plus realized and marked open-position movement.
              </p>
            </div>
          </div>
          <div className="holdings-list">
            <div className="lane-title">
              <strong>Open holdings</strong>
              <small>{report.holdings.length} symbols</small>
            </div>
            {report.holdings.length ? (
              report.holdings.map(([symbol, quantity]) => (
                <div key={symbol}>
                  <span>{symbol}</span>
                  <strong>{quantity}</strong>
                </div>
              ))
            ) : (
              <div className="terminal-empty compact">No open holding reconstructed</div>
            )}
          </div>
        </div>
      </section>
      <section className="report-panel">
        <div className="panel-title">
          <h2>Fill-by-fill ledger</h2>
          <small>Every row updates the running balance</small>
        </div>
        <DataTable
          columns={[
            "Time",
            "Symbol",
            "Side",
            "Quantity",
            "Price",
            "Fee",
            "Cash",
            "Position value",
            "Equity",
            "P/L"
          ]}
          rows={report.points
            .slice()
            .reverse()
            .map((point) => [
              formatTime(point.time),
              point.symbol,
              <span className={point.side === "BUY" ? "positive" : "negative"}>{point.side}</span>,
              point.quantity,
              formatUsd(point.price),
              `${point.fee} ${point.feeAsset}`,
              formatUsd(point.cash),
              formatUsd(point.positionValue),
              formatUsd(point.equity),
              <span className={toneForValue(point.pnl)}>{formatSignedUsd(point.pnl)}</span>
            ])}
          emptyLabel="No fills persisted yet"
        />
      </section>
    </main>
  );
}

function buildBalanceReport(
  fills: readonly FillRecord[],
  liveMarkPrices: ReadonlyMap<string, string>
): ReportModel {
  let cash = STARTING_BALANCE;
  const holdings = new Map<string, Decimal>();
  const marks = new Map(liveMarkPrices);
  const points: BalancePoint[] = [];
  const ordered = fills.slice().sort((a, b) => a.eventTimeMs - b.eventTimeMs);
  for (const fill of ordered) {
    const quantity = new Decimal(fill.quantity);
    const price = new Decimal(fill.price);
    const gross = quantity.mul(price);
    const baseAsset = baseAssetFromSymbol(fill.symbol);
    const fee = new Decimal(fill.fee || "0");
    const previousQty = holdings.get(fill.symbol) ?? new Decimal(0);
    if (fill.side === "BUY") {
      cash = cash.minus(gross);
      holdings.set(
        fill.symbol,
        previousQty.plus(quantity).minus(fill.feeAsset === baseAsset ? fee : 0)
      );
      if (fill.feeAsset === QUOTE_ASSET) cash = cash.minus(fee);
    } else {
      cash = cash.plus(gross);
      holdings.set(
        fill.symbol,
        previousQty.minus(quantity).minus(fill.feeAsset === baseAsset ? fee : 0)
      );
      if (fill.feeAsset === QUOTE_ASSET) cash = cash.minus(fee);
    }
    marks.set(fill.symbol, fill.price);
    const positionValue = valueHoldings(holdings, marks);
    const equity = cash.plus(positionValue);
    points.push({
      id: `${fill.clientOrderId}:${fill.tradeId}:${fill.eventTimeMs}`,
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
  for (const [symbol, mark] of liveMarkPrices) {
    if (mark) marks.set(symbol, mark);
  }
  const positionValue = valueHoldings(holdings, marks);
  const equity = cash.plus(positionValue);
  const pnl = equity.minus(STARTING_BALANCE);
  return {
    points,
    cash: cash.toFixed(8),
    positionValue: positionValue.toFixed(8),
    equity: equity.toFixed(8),
    pnl: pnl.toFixed(8),
    returnPct: STARTING_BALANCE.gt(0) ? pnl.div(STARTING_BALANCE).mul(100).toFixed(4) : null,
    holdings: [...holdings.entries()]
      .filter(([, quantity]) => quantity.abs().gt(0))
      .map(([symbol, quantity]) => [symbol, quantity.toFixed(8)])
  };
}

function valueHoldings(holdings: ReadonlyMap<string, Decimal>, marks: ReadonlyMap<string, string>) {
  let total = new Decimal(0);
  for (const [symbol, quantity] of holdings) {
    const mark = marks.get(symbol);
    if (mark) total = total.plus(quantity.mul(mark));
  }
  return total;
}

function baseAssetFromSymbol(symbol: string) {
  return symbol.endsWith(QUOTE_ASSET) ? symbol.slice(0, -QUOTE_ASSET.length) : symbol;
}

function BalanceCurve({ points }: { points: readonly BalancePoint[] }) {
  const values = [STARTING_BALANCE, ...points.map((point) => new Decimal(point.equity))];
  const min = Decimal.min(...values);
  const max = Decimal.max(...values);
  const range = Decimal.max(max.minus(min), new Decimal("0.0001"));
  const coords = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100;
    const y = new Decimal(100).minus(value.minus(min).div(range).mul(80).plus(10)).toNumber();
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const last = values.at(-1) ?? STARTING_BALANCE;
  return (
    <div className="balance-curve">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label="Running equity curve"
      >
        <line x1="0" y1="90" x2="100" y2="90" />
        <line x1="0" y1="50" x2="100" y2="50" />
        <polyline points={coords.join(" ")} />
      </svg>
      <div className="curve-label start">{formatUsd(STARTING_BALANCE.toFixed(8))}</div>
      <div className={`curve-label end ${toneForValue(last.minus(STARTING_BALANCE).toFixed(8))}`}>
        {formatUsd(last.toFixed(8))}
      </div>
    </div>
  );
}

function toneForValue(value: string | null | undefined) {
  if (!value) return "muted";
  try {
    return new Decimal(value).lt(0) ? "negative" : "positive";
  } catch {
    return "muted";
  }
}

function formatPercent(value: string | null) {
  if (!value) return "--";
  const decimal = new Decimal(value);
  return `${decimal.gte(0) ? "+" : ""}${decimal.toFixed(2)}%`;
}
