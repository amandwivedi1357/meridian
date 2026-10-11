import { useEffect, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Decimal } from "decimal.js";
import { Sidebar } from "../../components/terminal/Sidebar.js";
import { ConfirmDialog } from "../../components/terminal/ConfirmDialog.js";
import { DataTable } from "../../components/terminal/DataTable.js";
import { StatusBadge } from "../../components/terminal/StatusBadge.js";
import {
  ApiError,
  engageKillSwitch,
  pauseStrategy,
  resumeStrategy,
  type BookLevel
} from "../../lib/api-client.js";
import { useTerminalStore } from "../../lib/terminal-store.js";
import { formatSignedUsd, formatTime, formatUsd } from "../../lib/format.js";
import { MarketChart } from "./MarketChart.js";
import { SystemHealthPanel } from "./SystemHealthPanel.js";

type Action = { kind: "kill" } | { kind: "pause" | "resume"; strategyId: string };
export function DashboardPage({
  timeframe,
  onTimeframe
}: {
  timeframe: string;
  onTimeframe: (value: string) => void;
}) {
  const { market, account, principal, marketConnection, accountConnection } = useTerminalStore();
  const [tab, setTab] = useState("orders"),
    [dialog, setDialog] = useState<Action | null>(null),
    [reason, setReason] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const operator = principal?.role === "operator" && accountConnection === "live";
  const mutation = useMutation({
    mutationFn: async () => {
      if (!operator || !dialog || !reason.trim()) throw new Error("Action unavailable");
      if (dialog.kind === "kill") return engageKillSwitch(reason.trim());
      if (dialog.kind === "pause") return pauseStrategy(dialog.strategyId, reason.trim());
      return resumeStrategy(dialog.strategyId, reason.trim());
    },
    onSuccess: () => {
      setDialog(null);
      setReason("");
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401)
        useTerminalStore.getState().setSession(null, "required");
    }
  });
  const request = (action: Action) => {
    mutation.reset();
    setDialog(action);
    setReason("");
  };
  const rows: ReactNode[][] = [];
  let columns: string[] = [],
    empty = "No records";
  if (tab === "orders") {
    columns = ["Updated", "Pair", "Side", "Quantity", "Executed", "Limit", "State"];
    for (const o of account?.orders ?? [])
      rows.push([
        formatTime(o.updatedAtMs),
        o.symbol,
        o.side,
        o.quantity,
        o.executedQuantity,
        formatUsd(o.limitPrice),
        o.state
      ]);
    empty = "No orders";
  }
  if (tab === "fills") {
    columns = ["Time", "Pair", "Side", "Quantity", "Price", "Fee"];
    for (const f of account?.fills ?? [])
      rows.push([
        formatTime(f.eventTimeMs),
        f.symbol,
        f.side,
        f.quantity,
        formatUsd(f.price),
        `${f.fee} ${f.feeAsset}`
      ]);
    empty = "No fills";
  }
  if (tab === "positions") {
    columns = ["Pair", "Quantity", "Average entry", "Mark", "Realized", "Unrealized", "State"];
    for (const p of account?.portfolio?.positions ?? [])
      rows.push([
        p.symbol,
        p.quantity ?? "--",
        formatUsd(p.avgEntry),
        formatUsd(p.markPrice),
        formatSignedUsd(p.realizedPnl),
        formatSignedUsd(p.unrealizedPnl),
        p.reason ?? p.status
      ]);
    empty = "No tracked positions";
  }
  if (tab === "risk") {
    columns = ["Time", "Type", "Details"];
    for (const r of account?.riskEvents ?? [])
      rows.push([formatTime(r.tsMs), r.type, JSON.stringify(r.details)]);
    empty = "No risk events";
  }
  const fresh = market.updatedAt !== null && now - market.updatedAt <= 15000;
  const control = account?.riskControl;
  return (
    <main className="terminal-workspace">
      <Sidebar
        strategies={account?.strategies ?? []}
        operator={operator}
        onRequestPause={(strategyId) => request({ kind: "pause", strategyId })}
        onRequestResume={(strategyId) => request({ kind: "resume", strategyId })}
      >
        <SystemHealthPanel now={now} />
      </Sidebar>
      <section className="chart-workspace">
        <div className="chart-header">
          <div>
            <h1>BTCUSDT</h1>
            <strong>{formatUsd(market.trades.at(-1)?.price)}</strong>
          </div>
          <div className="timeframe-strip" role="group" aria-label="Candle interval">
            {["1m", "5m", "15m", "1h"].map((t) => (
              <button
                key={t}
                aria-pressed={timeframe === t}
                className={t === timeframe ? "active" : ""}
                onClick={() => onTimeframe(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <StatusBadge tone={fresh && marketConnection === "live" ? "green" : "amber"}>
            {fresh ? marketConnection : "Market stale"}
          </StatusBadge>
        </div>
        <MarketChart key={timeframe} candles={market.candles} />
        <section className="bottom-log-panel">
          <div className="bottom-tabs" role="tablist" aria-label="Account views">
            {["orders", "fills", "positions", "risk"].map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={t === tab}
                className={t === tab ? "active" : ""}
                onClick={() => setTab(t)}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
            <span>{accountConnection}</span>
          </div>
          <DataTable columns={columns} rows={rows} emptyLabel={empty} />
        </section>
      </section>
      <aside className="terminal-right-panel">
        <section className="side-panel risk-panel">
          <div className="panel-title">
            <span>Global risk control</span>
            <StatusBadge tone={control?.engaged ? "red" : "amber"}>
              {control?.engaged ? "Blocked" : control ? "Enabled" : "Unknown"}
            </StatusBadge>
          </div>
          <div className="risk-reason">
            <ShieldAlert size={14} />
            {control?.reason ?? "Account unavailable"}
          </div>
          <button
            className="emergency-button"
            disabled={!operator}
            onClick={() => request({ kind: "kill" })}
          >
            <AlertTriangle size={15} />
            Emergency stop
          </button>
        </section>
        <section className="side-panel order-book-panel">
          <div className="panel-title">
            <span>Order book</span>
            <small>Limited depth</small>
          </div>
          {market.book ? (
            <>
              <BookRows levels={market.book.asks} ask />
              <div className="book-mid">{formatUsd(market.trades.at(-1)?.price)}</div>
              <BookRows levels={market.book.bids} />
            </>
          ) : (
            <div className="terminal-empty compact">Book unavailable</div>
          )}
        </section>
        <section className="side-panel recent-trades-panel">
          <div className="panel-title">
            <span>Recent trades</span>
            <small>{fresh ? "Live" : "Stale"}</small>
          </div>
          {market.trades
            .slice(-8)
            .reverse()
            .map((t) => (
              <div key={t.id} className="recent-trade-row">
                <span className={t.side === "buy" ? "positive" : "negative"}>{t.side}</span>
                <b>{t.quantity}</b>
                <span>{formatUsd(t.price)}</span>
                <small>{formatTime(t.time)}</small>
              </div>
            ))}
          {!market.trades.length && <div className="terminal-empty compact">No recent trades</div>}
        </section>
        <section className="side-panel">
          <div className="panel-title">
            <span>Wallet / Testnet</span>
            <StatusBadge tone="muted">
              {account?.portfolio?.wallet?.status ?? "Unavailable"}
            </StatusBadge>
          </div>
          <div className="position-lines">
            <span>Equity / USDT</span>
            <b>{formatUsd(account?.portfolio?.equity)}</b>
            <span>Inventory</span>
            <b>{account?.portfolio?.wallet?.reconciliation ?? "--"}</b>
          </div>
          {account?.portfolio?.equityReason && (
            <p className="risk-reason">{account.portfolio.equityReason.replaceAll("_", " ")}</p>
          )}
        </section>
      </aside>
      <ConfirmDialog
        open={dialog !== null}
        title={
          dialog?.kind === "kill"
            ? "Engage kill switch"
            : dialog?.kind === "pause"
              ? "Pause strategy"
              : "Resume strategy"
        }
        description={
          dialog?.kind === "kill"
            ? "Confirm global execution stop."
            : dialog?.kind === "resume"
              ? "Resume does not clear the global kill switch."
              : "Confirm strategy pause."
        }
        confirmLabel={dialog?.kind === "resume" ? "Confirm resume" : "Confirm stop"}
        tone={dialog?.kind === "kill" ? "danger" : "primary"}
        busy={mutation.isPending}
        onCancel={() => setDialog(null)}
        onConfirm={() => mutation.mutate()}
      >
        <label className="dialog-field">
          Reason
          <textarea
            maxLength={500}
            required
            value={reason}
            disabled={mutation.isPending}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {mutation.isError && (
          <div className="dialog-error" role="alert">
            {mutation.error instanceof ApiError && mutation.error.status === 403
              ? "Operator permission required"
              : "Action failed. Check the reason and connection."}
          </div>
        )}
      </ConfirmDialog>
    </main>
  );
}
function BookRows({ levels, ask = false }: { levels: BookLevel[]; ask?: boolean }) {
  let sum = new Decimal(0);
  const rows = levels.slice(0, 5).map((l) => {
    sum = sum.plus(l.quantity);
    return { ...l, total: sum.toFixed() };
  });
  if (ask) rows.reverse();
  return (
    <div className={`book-rows ${ask ? "ask" : "bid"}`}>
      {rows.map((l) => (
        <div key={l.price}>
          <span>{formatUsd(l.price)}</span>
          <span>{l.quantity}</span>
          <span>{l.total}</span>
        </div>
      ))}
    </div>
  );
}
