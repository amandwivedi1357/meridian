import { Decimal } from "decimal.js";
import { Activity, ArrowDownRight, ArrowUpRight, CircleDollarSign, Wallet } from "lucide-react";
import { DataTable } from "../../components/terminal/DataTable.js";
import { StatusBadge } from "../../components/terminal/StatusBadge.js";
import { useEffect } from "react";
import { usePageEntrance, type EntranceSequence } from "../../lib/use-page-entrance.js";
import "./reports.css";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getFillReport } from "../../lib/api-client.js";
import {
  STARTING_BALANCE,
  QUOTE_ASSET,
  buildBalanceReport,
  reportMarks,
  type BalancePoint
} from "./report-model.js";
import { formatSignedUsd, formatTime, formatUsd } from "../../lib/format.js";
import { useTerminalStore } from "../../lib/terminal-store.js";

const reportEntrance: EntranceSequence = [
  [".reports-heading", 0, "translateX(-24px)"],
  [".report-hero", 80, "translateY(24px)"],
  [".report-chart-panel", 150, "translateY(24px)"],
  [".report-explanation-panel", 220, "translateX(24px)"],
  [".report-ledger", 300, "translateY(24px)"],
  [".report-unavailable", 80, "translateY(24px)"]
];

export function ReportsPage({ symbol }: { symbol: string }) {
  const { account, market, accountConnection, transport, session } = useTerminalStore();
  const cache = useQueryClient();
  const history = useQuery({
    queryKey: ["fill-report"],
    queryFn: ({ signal }) => getFillReport(signal),
    enabled: session === "ready",
    refetchInterval: 30000
  });
  const latestFill = account?.fills[0]?.executionId;
  useEffect(() => {
    if (latestFill) void cache.invalidateQueries({ queryKey: ["fill-report"] });
  }, [latestFill, cache]);
  const accountFresh =
    !!account &&
    transport.account.lastReceivedAt !== null &&
    Date.now() - transport.account.lastReceivedAt <= 45000;
  const latestTrade =
    market.candles.at(-1)?.symbol === symbol &&
    transport.market.lastReceivedAt !== null &&
    Date.now() - transport.market.lastReceivedAt <= 15000
      ? market.trades.at(-1)
      : undefined;
  const markPrices = reportMarks(
    accountFresh ? (account?.portfolio?.positions ?? []) : [],
    latestTrade ? { symbol, price: latestTrade.price } : undefined
  );
  const report =
    history.data && !history.isError && Date.now() - history.data.checkedAt <= 45000
      ? buildBalanceReport(history.data.fills, markPrices, history.data.complete)
      : null;
  const entranceRef = usePageEntrance<HTMLElement>("reports", reportEntrance, !history.isPending);
  if (!report)
    return (
      <main className="reports-page reports-porcelain" ref={entranceRef}>
        <header className="reports-heading">
          <h1>Trading report</h1>
          <StatusBadge tone="amber">{history.isPending ? "Loading" : "Unavailable"}</StatusBadge>
        </header>
        <section className="report-unavailable" aria-live="polite">
          <Wallet size={24} aria-hidden="true" />
          <h2>{history.isPending ? "Loading fill history" : "Report unavailable"}</h2>
          <p>
            {history.isPending
              ? "Retrieving the complete persisted fill ledger."
              : "Complete fill history, opening balances and current prices are required. No equity or P/L is inferred from the recent-fill window."}
          </p>
          <button
            className="report-refresh"
            type="button"
            disabled={history.isFetching}
            onClick={() => void history.refetch()}
          >
            Refresh report
          </button>
        </section>
      </main>
    );
  const lastPoint = report.points.at(-1);
  return (
    <main className="reports-page reports-porcelain" ref={entranceRef}>
      <header className="reports-heading">
        <div>
          <span>Complete fill ledger / hypothetical baseline</span>
          <h1>Trading report</h1>
          <p>
            Running equity from {STARTING_BALANCE.toFixed(2)} {QUOTE_ASSET} start capital,
            reconstructed from complete persisted fills and current mark prices. This 100 USDT model
            is not exchange-wallet or allocated equity.
          </p>
        </div>
        <StatusBadge tone={accountFresh && accountConnection === "live" ? "green" : "amber"}>
          {accountFresh ? accountConnection : "account stale"}
        </StatusBadge>
      </header>
      <div className="report-workspace">
        <section className="report-hero">
          <div className="report-equity-card">
            <div className="report-card-label">
              <Wallet size={16} />
              Model equity
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
              <small>
                {lastPoint ? `Last fill ${formatTime(lastPoint.time)}` : "No fills yet"}
              </small>
            </div>
            {report.points.length ? (
              <BalanceCurve points={report.points} />
            ) : (
              <div className="report-chart-empty">
                <span>No fills to plot</span>
                <p>The curve starts after the first persisted fill.</p>
              </div>
            )}
            <div className="balance-step-strip">
              {report.points.slice(-6).map((point) => (
                <div key={point.id}>
                  <span>{formatTime(point.time)}</span>
                  <strong className={toneForValue(point.pnl)}>{formatUsd(point.equity)}</strong>
                </div>
              ))}
              {!report.points.length && (
                <div className="report-baseline-note">
                  Hypothetical start balance: {STARTING_BALANCE.toFixed(2)} {QUOTE_ASSET}
                </div>
              )}
            </div>
          </div>
          <div className="report-panel report-explanation-panel">
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
        <section className="report-panel report-ledger">
          <div className="panel-title">
            <h2>Fill-by-fill ledger</h2>
            <small>Every row updates the running balance</small>
          </div>
          <div className="report-ledger-scroll" role="region" aria-label="Fill ledger" tabIndex={0}>
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
                  <span className={point.side === "BUY" ? "positive" : "negative"}>
                    {point.side}
                  </span>,
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
          </div>
        </section>
      </div>
    </main>
  );
}

function BalanceCurve({ points }: { points: readonly BalancePoint[] }) {
  const values = [STARTING_BALANCE, ...points.map((point) => new Decimal(point.equity))];
  const min = Decimal.min(...values);
  const max = Decimal.max(...values);
  const range = Decimal.max(max.minus(min), new Decimal("0.0001"));
  const coords = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100;
    const y = max.eq(min)
      ? 50
      : new Decimal(100).minus(value.minus(min).div(range).mul(80).plus(10)).toNumber();
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
