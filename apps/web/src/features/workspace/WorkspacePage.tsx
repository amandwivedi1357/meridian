import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Pause, Play, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { Decimal } from "decimal.js";
import type { PageId } from "../../app/navigation.js";
import { pages } from "../../app/navigation.js";
import { DataTable } from "../../components/terminal/DataTable.js";
import { ConfirmDialog } from "../../components/terminal/ConfirmDialog.js";
import { StatusBadge } from "../../components/terminal/StatusBadge.js";
import {
  ApiError,
  cancelOrder,
  engageKillSwitch,
  getAccountSummary,
  getDashboard,
  getTradingState,
  getWorkspaceSummary,
  type MarketInstrument,
  type OrderRecord,
  pauseStrategy,
  resumeStrategy
} from "../../lib/api-client.js";
import { useTerminalStore } from "../../lib/terminal-store.js";
import { formatTime, formatUsd, formatSignedUsd } from "../../lib/format.js";
import { MarketChart } from "../dashboard/MarketChart.js";
import { SystemHealthPanel } from "../dashboard/SystemHealthPanel.js";
import { age, sampleFresh } from "../dashboard/health-model.js";
import { ManualOrderTicket } from "./ManualOrderTicket.js";
import { MarketPanels } from "./MarketPanels.js";
import { TradeDrawer } from "./TradeDrawer.js";
import { activity, openOrders, uncertainOrders } from "./workspace-model.js";

type Action =
  | { kind: "kill" }
  | { kind: "pause" | "resume"; strategyId: string }
  | { kind: "cancel"; order: OrderRecord };
function Section({
  title,
  children,
  extra
}: {
  title: string;
  children: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <section className="workspace-section">
      <div className="panel-title">
        <h2>{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}
function Readings({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="workspace-readings">
      {rows.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{value ?? "Not reported"}</dd>
        </div>
      ))}
    </dl>
  );
}
export function WorkspacePage({
  view,
  timeframe,
  onTimeframe,
  symbol,
  instruments,
  instrumentError = null,
  instrumentsLoading = false,
  onRetryInstruments,
  onSymbol
}: {
  view: Exclude<PageId, "backtests" | "reports">;
  timeframe: string;
  onTimeframe: (value: string) => void;
  symbol: string;
  instruments: readonly MarketInstrument[];
  instrumentError?: string | null;
  instrumentsLoading?: boolean;
  onRetryInstruments?: () => void;
  onSymbol: (value: string) => void;
}) {
  const { account, market, health, principal, marketConnection, accountConnection, transport } =
    useTerminalStore();
  const [now, setNow] = useState(Date.now());
  const [tab, setTab] = useState("orders");
  const [selected, setSelected] = useState("");
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const fresh = sampleFresh(health, now);
  const selectedInstrument = instruments.find((item) => item.symbol === symbol);
  const baseAsset = selectedInstrument?.baseAsset ?? "--";
  const quoteAsset = selectedInstrument?.quoteAsset ?? "--";
  const marketFresh = market.updatedAt !== null && now - market.updatedAt <= 15000;
  const accountFresh =
    !!account &&
    transport.account.lastReceivedAt !== null &&
    now - transport.account.lastReceivedAt <= 45000;
  const operator = principal?.role === "operator" && accountConnection === "live" && accountFresh;
  const diagnostics = useQuery({
    queryKey: ["storage-snapshot", principal?.actor],
    queryFn: async ({ signal }) => {
      try {
        return await getDashboard(signal);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401)
          useTerminalStore.getState().setSession(null, "required");
        throw error;
      }
    },
    enabled: view === "market" || view === "system",
    staleTime: 15000,
    retry: false,
    refetchOnWindowFocus: false
  });
  const summary = useQuery({
    queryKey: ["workspace-summary", principal?.actor],
    queryFn: async ({ signal }) => {
      try {
        return await getWorkspaceSummary(signal);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401)
          useTerminalStore.getState().setSession(null, "required");
        throw error;
      }
    },
    enabled: view === "risk" || view === "system",
    staleTime: 15000,
    retry: false,
    refetchOnWindowFocus: false
  });
  const limits = summary.data?.configuration.limits;
  const mutation = useMutation({
    mutationFn: async () => {
      if (
        !operator ||
        !action ||
        !reason.trim() ||
        (action.kind !== "pause" &&
          confirmation !==
            (action.kind === "kill" ? "STOP" : action.kind === "resume" ? "RESUME" : "CANCEL"))
      )
        throw new Error("Confirmation required");
      if (action.kind === "kill") return engageKillSwitch(reason.trim());
      if (action.kind === "cancel")
        return cancelOrder(action.order.clientOrderId, {
          reason: reason.trim(),
          confirm: "CANCEL_ORDER"
        });
      return action.kind === "pause"
        ? pauseStrategy(action.strategyId, reason.trim())
        : resumeStrategy(action.strategyId, reason.trim());
    },
    onSuccess: async () => {
      if (action?.kind === "cancel") {
        const [state, summary] = await Promise.all([getTradingState(), getAccountSummary()]);
        useTerminalStore.setState({ account: { ...state, portfolio: summary.portfolio } });
      }
      setAction(null);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401)
        useTerminalStore.getState().setSession(null, "required");
    }
  });
  function request(value: Action) {
    mutation.reset();
    setAction(value);
    setReason("");
    setConfirmation("");
  }
  const control = account?.riskControl;
  const position = account?.portfolio?.positions.find((p) => p.symbol === symbol);
  const strategy =
    account?.strategies.find((s) => s.strategyId === selected) ?? account?.strategies[0];
  const events = activity(account);
  const orders = openOrders(account);
  const unknown = uncertainOrders(account);
  const protectedPosition = account?.portfolio?.positions.find((p) => p.symbol === symbol);
  const lastTradePrice = market.trades.at(-1)?.price ?? null;
  const liveMarkPrice = protectedPosition?.markPrice ?? lastTradePrice;
  const liveUnrealizedPnl =
    protectedPosition?.unrealizedPnl ??
    estimateSpotPnl(protectedPosition?.quantity, protectedPosition?.avgEntry, liveMarkPrice);
  const liveReturnPct = estimateSpotReturn(protectedPosition?.avgEntry, liveMarkPrice);
  const liveNotional = estimateNotional(protectedPosition?.quantity, liveMarkPrice);
  const activeSymbolOrders = orders.filter((o) => o.symbol === symbol);
  const recentSymbolFills = (account?.fills ?? [])
    .filter((f) => f.symbol === symbol)
    .slice()
    .sort((a, b) => b.eventTimeMs - a.eventTimeMs)
    .slice(0, 6);
  const canCancel = (order: OrderRecord) =>
    operator &&
    !control?.engaged &&
    (order.state === "NEW" ||
      order.state === "PARTIALLY_FILLED" ||
      order.state === "UNKNOWN" ||
      order.state === "PENDING_CANCEL");
  const status = (value: string, good = value === "available" || value === "live") => (
    <StatusBadge tone={good ? "green" : "amber"}>{value}</StatusBadge>
  );
  const serviceRows: [string, ReactNode][] = [
    [
      "API",
      status(
        accountConnection === "live" && accountFresh ? "Responding" : "Unknown",
        accountConnection === "live" && accountFresh
      )
    ],
    ["Redis", status(fresh ? health!.redis : "Unknown")],
    ["TimescaleDB", status(fresh ? health!.database : "Unknown")],
    [
      "Ingestor",
      status(
        marketFresh && marketConnection === "live" ? "Feed live" : "Feed stale",
        marketFresh && marketConnection === "live"
      )
    ],
    ["Engine", "Not reported"],
    ["Executor", "Not reported"]
  ];
  const risk = (
    <>
      <div className="risk-state-banner">
        <ShieldAlert size={22} />
        <div>
          <strong>
            {control
              ? control.engaged
                ? "Global execution blocked"
                : "Kill switch disengaged"
              : "Risk state unavailable"}
          </strong>
          <p>{control?.reason ?? "Waiting for account snapshot"}</p>
        </div>
        {status(control?.engaged ? "Engaged" : control ? "Disengaged" : "Unknown", false)}
      </div>
      <Readings
        rows={[
          ["Updated", control ? formatTime(control.updatedAtMs) : "--"],
          ["Account feed", accountFresh ? accountConnection : "Stale"],
          ["Open orders (loaded)", account ? orders.length : "--"],
          [`Managed ${baseAsset} quantity`, position?.quantity ?? "--"],
          ["Mark / USDT", formatUsd(position?.markPrice)],
          ["Unrealized / USDT", formatSignedUsd(position?.unrealizedPnl)]
        ]}
      />
      <button
        className="emergency-button"
        disabled={!operator}
        onClick={() => request({ kind: "kill" })}
      >
        <AlertTriangle size={16} /> Engage kill switch
      </button>
    </>
  );
  const accountSummary = (
    <div className="overview-metrics">
      {[
        ["Allocated equity / USDT", "Not reported"],
        ["Wallet equity / USDT", formatUsd(account?.portfolio?.equity)],
        [`Managed ${baseAsset} position`, position?.quantity ?? "--"],
        ["Open orders / loaded", account ? String(orders.length) : "--"],
        ["Recent fills / loaded", account ? String(account.fills.length) : "--"],
        ["Risk state", control ? (control.engaged ? "BLOCKED" : "DISENGAGED") : "UNKNOWN"]
      ].map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
  const timeline = (
    <div className="activity-timeline">
      {events.length ? (
        events.map((e) => (
          <div key={e.id}>
            <time>{formatTime(e.time)}</time>
            <span className={e.kind === "Risk" ? "negative" : "positive"}>{e.kind}</span>
            <div>
              <strong>{e.title}</strong>
              <p>{e.detail}</p>
            </div>
          </div>
        ))
      ) : (
        <div className="terminal-empty compact">No recent activity</div>
      )}
    </div>
  );
  const marketHealth = (
    <>
      <Readings
        rows={[
          ["Last event age", age(market.updatedAt, now)],
          ["Market SSE", marketConnection],
          [
            "Redis trade stream length",
            fresh
              ? (health?.streams.find((s) => s.stream === `market.trade.${symbol}`)?.length ?? "--")
              : "--"
          ],
          [
            "BTCUSDT DB persisted trades / sampled",
            diagnostics.data?.database.count?.toLocaleString() ?? "--"
          ],
          ["Count sample age", age(diagnostics.data?.database.checkedAt ?? null, now)],
          ["Continuous feed recorder", "Disabled"],
          [
            "Historical soak file",
            diagnostics.data?.recording
              ? `${(diagnostics.data.recording.bytes / 1048576).toFixed(1)} MiB / ${age(Math.trunc(diagnostics.data.recording.updatedAt), now)} old`
              : "Not available"
          ]
        ]}
      />
      {diagnostics.isError && (
        <p role="alert" className="negative">
          Storage snapshot unavailable
        </p>
      )}
    </>
  );
  const refresh = (
    <button
      className="icon-button"
      title="Refresh storage snapshot"
      aria-label="Refresh storage snapshot"
      disabled={diagnostics.isFetching}
      onClick={() => void diagnostics.refetch()}
    >
      <RefreshCw size={15} />
    </button>
  );
  let columns: string[] = [];
  let rows: ReactNode[][] = [];
  if (tab === "orders" || tab === "reconciliation") {
    columns = [
      "Client order ID",
      "Exchange order ID",
      "Strategy ID",
      "Signal ID",
      "Symbol",
      "Side",
      "Type",
      "Quantity",
      "Executed",
      "Price",
      "State",
      "Updated",
      "Action"
    ];
    rows = (tab === "reconciliation" ? unknown : (account?.orders ?? [])).map((o) => [
      o.clientOrderId,
      o.exchangeOrderId ?? "--",
      o.strategyId,
      o.signalId,
      o.symbol,
      o.side,
      o.type,
      o.quantity,
      o.executedQuantity,
      formatUsd(o.limitPrice),
      o.state,
      formatTime(o.updatedAtMs),
      canCancel(o) ? (
        <button
          className="terminal-row-action danger"
          type="button"
          onClick={() => request({ kind: "cancel", order: o })}
        >
          <XCircle size={13} />
          Cancel
        </button>
      ) : (
        <span className="muted">--</span>
      )
    ]);
  } else if (tab === "fills") {
    columns = [
      "Time",
      "Client order ID",
      "Exchange order ID",
      "Strategy ID",
      "Signal ID",
      "Trade ID",
      "Execution ID",
      "Symbol",
      "Side",
      "Quantity",
      "Price",
      "Fee"
    ];
    rows = (account?.fills ?? []).map((f) => {
      const order = account?.orders.find((o) => o.clientOrderId === f.clientOrderId);
      return [
        formatTime(f.eventTimeMs),
        f.clientOrderId,
        order?.exchangeOrderId ?? "--",
        f.strategyId,
        order?.signalId ?? "--",
        f.tradeId,
        f.executionId,
        f.symbol,
        f.side,
        f.quantity,
        formatUsd(f.price),
        `${f.fee} ${f.feeAsset}`
      ];
    });
  } else {
    columns = [
      "Symbol",
      "Managed quantity",
      "Average entry",
      "Mark",
      "Realized",
      "Unrealized",
      "State"
    ];
    rows = (account?.portfolio?.positions ?? []).map((p) => [
      p.symbol,
      p.quantity ?? "--",
      formatUsd(p.avgEntry),
      formatUsd(p.markPrice),
      formatSignedUsd(p.realizedPnl),
      formatSignedUsd(p.unrealizedPnl),
      p.reason ?? p.status
    ]);
  }
  return (
    <main className={`workspace-page workspace-${view}`}>
      <header className="workspace-heading">
        <div>
          <h1>{pages.find((p) => p.id === view)!.label}</h1>
          <span>
            {view === "market" ? `${symbol} / Binance Spot` : "Meridian / Testnet account"}
          </span>
        </div>
        <div className="workspace-header-actions">
          {status(
            view === "market"
              ? marketFresh
                ? marketConnection
                : "Market stale"
              : accountFresh
                ? accountConnection
                : "Account stale"
          )}
          {view === "market" && (
            <TradeDrawer
              symbol={symbol}
              baseAsset={baseAsset}
              quoteAsset={quoteAsset}
              instruments={instruments}
              onSymbol={onSymbol}
              operator={operator}
              riskEngaged={control?.engaged ?? false}
              lastPrice={market.trades.at(-1)?.price}
            />
          )}
        </div>
      </header>
      {view === "overview" && (
        <>
          <div className="service-strip">
            {serviceRows.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                {value}
              </div>
            ))}
          </div>
          {accountSummary}
          <div className="workspace-grid">
            <Section
              title={`${symbol} / ${timeframe}`}
              extra={formatUsd(market.trades.at(-1)?.price)}
            >
              <div className="overview-chart">
                <MarketChart
                  candles={market.candles}
                  baseAsset={baseAsset}
                  fills={(account?.fills ?? []).filter((fill) => fill.symbol === symbol)}
                />
              </div>
            </Section>
            <Section title="Active strategies">
              <Readings
                rows={(account?.strategies ?? []).map((s) => [
                  s.strategyId,
                  s.paused ? "Paused" : "Not paused"
                ])}
              />
              {!account?.strategies.length && (
                <div className="terminal-empty compact">No strategy state</div>
              )}
              <h3>Recent fills</h3>
              <DataTable
                columns={["Time", "Side", "Quantity", "Price"]}
                rows={(account?.fills ?? [])
                  .slice(0, 5)
                  .map((f) => [formatTime(f.eventTimeMs), f.side, f.quantity, formatUsd(f.price)])}
                emptyLabel="No fills"
              />
            </Section>
          </div>
          <Section title="Trading & risk activity">{timeline}</Section>
        </>
      )}
      {view === "market" && (
        <div className="market-page-layout">
          <div className="market-primary">
            <div className="chart-header">
              <div>
                <h2>{symbol}</h2>
                <strong>{formatUsd(market.trades.at(-1)?.price)}</strong>
              </div>
              <label className="instrument-picker">
                Instrument
                <select
                  value={symbol}
                  disabled={instrumentsLoading}
                  onChange={(event) => onSymbol(event.target.value)}
                >
                  {instruments.map((instrument) => (
                    <option key={instrument.symbol} value={instrument.symbol}>
                      {instrument.baseAsset} / {instrument.quoteAsset}
                    </option>
                  ))}
                </select>
              </label>
              <div className="timeframe-strip" role="group" aria-label="Candle interval">
                {["1m", "15m", "1h"].map((t) => (
                  <button
                    key={t}
                    aria-pressed={timeframe === t}
                    className={timeframe === t ? "active" : ""}
                    onClick={() => onTimeframe(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            {instrumentError && (
              <div className="instrument-error" role="alert">
                <span>{instrumentError}</span>
                <button
                  type="button"
                  title="Retry instrument list"
                  aria-label="Retry instrument list"
                  disabled={instrumentsLoading}
                  onClick={onRetryInstruments}
                >
                  <RefreshCw size={14} />
                </button>
              </div>
            )}
            <div className="main-market-chart">
              <MarketChart
                key={`${symbol}:${timeframe}`}
                baseAsset={baseAsset}
                candles={market.candles.filter((c) => c.interval === timeframe)}
                fills={(account?.fills ?? []).filter((fill) => fill.symbol === symbol)}
              />
            </div>
          </div>
          <aside className="market-microstructure">
            <MarketPanels
              book={market.book}
              trades={market.trades}
              baseAsset={baseAsset}
              quoteAsset={quoteAsset}
            />
          </aside>
          <div className="market-secondary">
            <Section title="Market data health" extra={refresh}>
              {marketHealth}
            </Section>
          </div>
        </div>
      )}
      {view === "trading" && (
        <>
          <div className="trading-control-grid">
            <ManualOrderTicket
              symbol={symbol}
              baseAsset={baseAsset}
              quoteAsset={quoteAsset}
              instruments={instruments}
              onSymbol={onSymbol}
              operator={operator}
              riskEngaged={control?.engaged ?? false}
              lastPrice={market.trades.at(-1)?.price}
            />
            <section className="protective-order-panel" aria-labelledby="protective-orders-title">
              <div className="manual-trade-head">
                <div>
                  <h2 id="protective-orders-title">Protective orders</h2>
                  <p>Stop-loss / take-profit automation is not armed yet.</p>
                </div>
                <StatusBadge tone="amber">Designing</StatusBadge>
              </div>
              <Readings
                rows={[
                  ["Symbol", symbol],
                  [`Managed ${baseAsset}`, protectedPosition?.quantity ?? "--"],
                  ["Average entry", formatUsd(protectedPosition?.avgEntry)],
                  ["Mark", formatUsd(liveMarkPrice)],
                  ["Required before arming", "cancel + reconciliation + trigger monitor"]
                ]}
              />
              <div className="protective-draft-grid">
                <label className="manual-field">
                  Stop-loss / {quoteAsset}
                  <input disabled placeholder="Next slice" />
                </label>
                <label className="manual-field">
                  Take-profit / {quoteAsset}
                  <input disabled placeholder="Next slice" />
                </label>
              </div>
              <p className="workspace-footnote">
                For now, close the position manually with an opposite market order. Brackets will be
                enabled only after durable trigger handling is implemented.
              </p>
            </section>
          </div>
          <section className="live-trading-cockpit" aria-labelledby="live-trading-title">
            <div className="live-cockpit-hero">
              <div>
                <span className="eyebrow">Live position</span>
                <h2 id="live-trading-title">{symbol}</h2>
                <p>
                  {protectedPosition?.status ?? "No managed position"} /{" "}
                  {accountFresh ? "account feed live" : "account feed stale"}
                </p>
              </div>
              <div className="live-pnl-stack">
                <span>Unrealized PnL / {quoteAsset}</span>
                <strong className={toneForNumber(liveUnrealizedPnl)}>
                  {formatSignedUsd(liveUnrealizedPnl)}
                </strong>
                <em className={toneForNumber(liveReturnPct)}>
                  {formatSignedPercent(liveReturnPct)} at {formatUsd(liveMarkPrice)}
                </em>
              </div>
            </div>
            <div className="live-cockpit-grid">
              <div>
                <span>Quantity / {baseAsset}</span>
                <strong>{protectedPosition?.quantity ?? "--"}</strong>
              </div>
              <div>
                <span>Average entry</span>
                <strong>{formatUsd(protectedPosition?.avgEntry)}</strong>
              </div>
              <div>
                <span>Mark price</span>
                <strong>{formatUsd(liveMarkPrice)}</strong>
              </div>
              <div>
                <span>Position notional</span>
                <strong>{formatUsd(liveNotional)}</strong>
              </div>
              <div>
                <span>Realized PnL</span>
                <strong className={toneForNumber(protectedPosition?.realizedPnl)}>
                  {formatSignedUsd(protectedPosition?.realizedPnl)}
                </strong>
              </div>
              <div>
                <span>Working orders</span>
                <strong>{activeSymbolOrders.length}</strong>
              </div>
            </div>
            <div className="live-cockpit-lanes">
              <div>
                <div className="lane-title">
                  <strong>Working orders</strong>
                  <small>{activeSymbolOrders.length} active</small>
                </div>
                <div className="working-order-stack">
                  {activeSymbolOrders.length ? (
                    activeSymbolOrders.slice(0, 5).map((order) => (
                      <div className="working-order-card" key={order.clientOrderId}>
                        <div>
                          <strong className={order.side === "BUY" ? "positive" : "negative"}>
                            {order.side} {order.type}
                          </strong>
                          <span>{order.quantity} requested</span>
                        </div>
                        <div>
                          <span>{order.state}</span>
                          <strong>{order.executedQuantity} filled</strong>
                        </div>
                        <div>
                          <span>Limit</span>
                          <strong>{formatUsd(order.limitPrice)}</strong>
                        </div>
                        {canCancel(order) ? (
                          <button
                            className="terminal-row-action danger"
                            type="button"
                            onClick={() => request({ kind: "cancel", order })}
                          >
                            <XCircle size={13} />
                            Cancel
                          </button>
                        ) : (
                          <span className="muted">No action</span>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="terminal-empty compact">No working orders for {symbol}</div>
                  )}
                </div>
              </div>
              <div>
                <div className="lane-title">
                  <strong>Recent fills</strong>
                  <small>{recentSymbolFills.length} shown</small>
                </div>
                <div className="recent-fill-stack">
                  {recentSymbolFills.length ? (
                    recentSymbolFills.map((fill) => (
                      <div
                        className="recent-fill-row"
                        key={`${fill.clientOrderId}:${fill.tradeId}`}
                      >
                        <time>{formatTime(fill.eventTimeMs)}</time>
                        <strong className={fill.side === "BUY" ? "positive" : "negative"}>
                          {fill.side}
                        </strong>
                        <span>{fill.quantity}</span>
                        <span>{formatUsd(fill.price)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="terminal-empty compact">No fills for {symbol}</div>
                  )}
                </div>
              </div>
            </div>
          </section>
          <div className="overview-metrics">
            <div>
              <span>Open orders / loaded</span>
              <strong>{account ? orders.length : "--"}</strong>
            </div>
            <div>
              <span>Awaiting lifecycle confirmation</span>
              <strong>{account ? unknown.length : "--"}</strong>
            </div>
            <div>
              <span>Snapshot</span>
              <strong>{age(account?.checkedAt ?? null, now)} old</strong>
            </div>
          </div>
          <div className="bottom-tabs" role="tablist" aria-label="Trading views">
            {["orders", "fills", "positions", "reconciliation"].map((t) => (
              <button
                role="tab"
                key={t}
                className={tab === t ? "active" : ""}
                aria-selected={tab === t}
                onClick={() => setTab(t)}
              >
                {t === "reconciliation"
                  ? "Unknown / reconciliation"
                  : t[0]!.toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <div role="tabpanel" aria-label={tab}>
            <DataTable
              columns={columns}
              rows={rows}
              emptyLabel={account ? "No records in loaded snapshot" : "Account unavailable"}
            />
          </div>
          <p className="workspace-footnote">
            Latest 100 records per feed. Pending submissions/cancellations require lifecycle
            confirmation; UNKNOWN requires reconciliation.
          </p>
        </>
      )}
      {view === "risk" && (
        <>
          <div className="workspace-grid">
            <Section title="Global kill switch">{risk}</Section>
            <Section title="Risk limits">
              <Readings
                rows={[
                  ["Max notional / USDT", "MAX_NOTIONAL"],
                  ["Max quantity / BTC", "MAX_QUANTITY"],
                  ["Max position / BTC", "MAX_POSITION"],
                  ["Max open orders", "MAX_OPEN_ORDERS"],
                  ["Orders per minute", "MAX_ORDERS_PER_MINUTE"],
                  ["Daily loss / USDT", "MAX_DAILY_LOSS"],
                  ["Drawdown / fraction", "MAX_DRAWDOWN"]
                ].map(([name, key]) => [name!, limits?.[key!] ?? "Not reported"])}
              />
              <p className="workspace-footnote">
                {summary.data?.configuration.source ?? "Configuration unavailable"}
              </p>
            </Section>
          </div>
          <Section title="Current exposure">
            <Readings
              rows={[
                [`${baseAsset} managed position`, position?.quantity ?? "--"],
                [
                  "Managed notional / USDT",
                  position?.quantity != null && position.markPrice != null
                    ? new Decimal(position.quantity).abs().mul(position.markPrice).toFixed(2)
                    : "--"
                ],
                ["Wallet reconciliation", account?.portfolio?.wallet?.reconciliation ?? "--"]
              ]}
            />
          </Section>
          <Section title="Risk events">
            <DataTable
              columns={["Time", "Type", "Details"]}
              rows={(account?.riskEvents ?? []).map((r) => [
                formatTime(r.tsMs),
                r.type,
                JSON.stringify(r.details)
              ])}
              emptyLabel="No risk events"
            />
          </Section>
          <Section title="Audit log preview">
            <DataTable
              columns={["Time", "Actor", "Action"]}
              rows={(summary.data?.audits ?? []).map((a) => [
                formatTime(Number(a.tsMs)),
                a.actor,
                a.action
              ])}
              emptyLabel={summary.data?.audits ? "No audit entries" : "Audit snapshot unavailable"}
            />
            <button
              className="icon-button"
              title="Refresh audit and configuration"
              aria-label="Refresh audit and configuration"
              disabled={summary.isFetching}
              onClick={() => void summary.refetch()}
            >
              <RefreshCw size={15} />
            </button>
          </Section>
        </>
      )}
      {view === "strategies" && (
        <div className="workspace-grid strategy-layout">
          <Section title="Strategy list">
            {account?.strategies.length ? (
              account.strategies.map((s) => (
                <button
                  className={`strategy-select ${strategy?.strategyId === s.strategyId ? "active" : ""}`}
                  key={s.strategyId}
                  onClick={() => setSelected(s.strategyId)}
                >
                  <strong>{s.strategyId}</strong>
                  <span>{s.paused ? "Paused" : "Not paused"}</span>
                  <small>{s.reason}</small>
                </button>
              ))
            ) : (
              <div className="terminal-empty compact">No strategy state</div>
            )}
          </Section>
          <Section title={strategy?.strategyId ?? "Strategy detail"}>
            <Readings
              rows={[
                ["Control status", strategy ? (strategy.paused ? "Paused" : "Not paused") : "--"],
                ["Control updated", strategy ? formatTime(strategy.updatedAtMs) : "--"],
                ["Control reason", strategy?.reason ?? "--"],
                ["Symbol", strategy ? symbol : "--"],
                ["Interval", "Not reported"],
                ["Last signal", "Not reported"],
                ["Last run", "Not reported"],
                ["Strategy position", "Not reported"],
                ["Strategy PnL", "Not reported"],
                ["Last input candle", "Not reported"]
              ]}
            />
            <div className="strategy-actions">
              <button
                className="terminal-button terminal-button-ghost"
                disabled={!operator || !strategy || strategy.paused}
                onClick={() =>
                  strategy && request({ kind: "pause", strategyId: strategy.strategyId })
                }
              >
                <Pause size={15} />
                Pause
              </button>
              <button
                className="terminal-button terminal-button-primary"
                disabled={!operator || !strategy || !strategy.paused}
                onClick={() =>
                  strategy && request({ kind: "resume", strategyId: strategy.strategyId })
                }
              >
                <Play size={15} />
                Request resume
              </button>
            </div>
            <h3>Recent decisions / risk approval</h3>
            <DataTable
              columns={["Time", "Type", "Reason"]}
              rows={(account?.riskEvents ?? [])
                .filter(
                  (r) =>
                    !!strategy &&
                    typeof r.details === "object" &&
                    r.details !== null &&
                    "strategyId" in r.details &&
                    r.details.strategyId === strategy.strategyId
                )
                .map((r) => [formatTime(r.tsMs), r.type, JSON.stringify(r.details)])}
              emptyLabel="No strategy-linked risk events in snapshot"
            />
          </Section>
        </div>
      )}
      {view === "system" && (
        <>
          <div className="workspace-grid">
            <Section title="Services">
              <Readings
                rows={[
                  ...serviceRows,
                  ["Web", "Rendered locally"],
                  ["Backtest Worker", "Not reported"]
                ]}
              />
            </Section>
            <Section title="Storage" extra={refresh}>
              {marketHealth}
            </Section>
          </div>
          <div className="workspace-grid">
            <Section title="Stream health">
              <SystemHealthPanel now={now} />
            </Section>
            <Section title="Runtime configuration">
              <Readings
                rows={[
                  ["Dashboard symbol", symbol],
                  [
                    "Market environment / configured",
                    summary.data?.configuration.marketEnvironment ?? "Not reported"
                  ],
                  [
                    "Trading environment / configured",
                    summary.data?.configuration.tradingEnvironment ?? "Not reported"
                  ],
                  ["Redis feed retention", "Approx. 2,000 entries / stream"],
                  ["DB retention", "Not reported"],
                  ["NDJSON recording", "Disabled for continuous dashboard feed"],
                  [
                    "Allocation mode / configured",
                    summary.data?.configuration.allocationMode ?? "Not reported"
                  ]
                ]}
              />
              <h3>Applied migrations</h3>
              <DataTable
                columns={["Migration", "Applied at"]}
                rows={(summary.data?.migrations ?? []).map((m) => [m.id, m.appliedAt])}
                emptyLabel={
                  summary.data?.migrations
                    ? "No recorded migrations"
                    : "Migration snapshot unavailable"
                }
              />
              <button
                className="icon-button"
                title="Refresh migrations and configuration"
                aria-label="Refresh migrations and configuration"
                disabled={summary.isFetching}
                onClick={() => void summary.refetch()}
              >
                <RefreshCw size={15} />
              </button>
            </Section>
          </div>
        </>
      )}
      <ConfirmDialog
        open={action !== null}
        title={
          action?.kind === "kill"
            ? "Engage global kill switch"
            : action?.kind === "cancel"
              ? "Cancel open order"
              : action?.kind === "resume"
                ? "Confirm strategy resume"
                : "Pause strategy"
        }
        description={
          action?.kind === "resume"
            ? "Strategy execution may resume. The global kill switch remains unchanged."
            : action?.kind === "cancel"
              ? "Cancel this exchange order. The order will move through PENDING_CANCEL until Binance/user-data confirms the terminal state."
              : action?.kind === "kill"
                ? "Block new execution globally. Existing orders follow executor cancellation handling."
                : "Pause this strategy."
        }
        confirmLabel={
          action?.kind === "resume"
            ? "Confirm resume"
            : action?.kind === "cancel"
              ? "Cancel order"
              : action?.kind === "kill"
                ? "Engage kill switch"
                : "Confirm pause"
        }
        tone={action?.kind === "kill" || action?.kind === "cancel" ? "danger" : "primary"}
        busy={mutation.isPending}
        disabled={
          !operator ||
          !reason.trim() ||
          (action?.kind !== "pause" &&
            confirmation !==
              (action?.kind === "kill" ? "STOP" : action?.kind === "resume" ? "RESUME" : "CANCEL"))
        }
        onCancel={() => setAction(null)}
        onConfirm={() => mutation.mutate()}
      >
        <label className="dialog-field">
          Reason
          <textarea
            required
            maxLength={500}
            value={reason}
            disabled={mutation.isPending}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {action?.kind !== "pause" && (
          <label className="dialog-field">
            Type{" "}
            {action?.kind === "kill" ? "STOP" : action?.kind === "resume" ? "RESUME" : "CANCEL"} to
            confirm
            <input
              autoComplete="off"
              value={confirmation}
              disabled={mutation.isPending}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
        )}
        {mutation.isError && (
          <p className="dialog-error" role="alert">
            Action failed. Check confirmation, reason and account connection.
          </p>
        )}
      </ConfirmDialog>
    </main>
  );
}

function estimateSpotPnl(
  quantity: string | null | undefined,
  avgEntry: string | null | undefined,
  markPrice: string | null | undefined
) {
  if (!quantity || !avgEntry || !markPrice) return null;
  try {
    const qty = new Decimal(quantity);
    if (qty.isZero()) return "0";
    return new Decimal(markPrice).minus(avgEntry).mul(qty).toFixed(8);
  } catch {
    return null;
  }
}

function estimateSpotReturn(
  avgEntry: string | null | undefined,
  markPrice: string | null | undefined
) {
  if (!avgEntry || !markPrice) return null;
  try {
    const entry = new Decimal(avgEntry);
    if (entry.lte(0)) return null;
    return new Decimal(markPrice).minus(entry).div(entry).mul(100).toFixed(4);
  } catch {
    return null;
  }
}

function estimateNotional(
  quantity: string | null | undefined,
  markPrice: string | null | undefined
) {
  if (!quantity || !markPrice) return null;
  try {
    return new Decimal(quantity).abs().mul(markPrice).toFixed(8);
  } catch {
    return null;
  }
}

function toneForNumber(value: string | null | undefined) {
  if (!value) return "muted";
  try {
    return new Decimal(value).lt(0) ? "negative" : "positive";
  } catch {
    return "muted";
  }
}

function formatSignedPercent(value: string | null | undefined) {
  if (!value) return "--";
  try {
    const percent = new Decimal(value);
    return `${percent.gte(0) ? "+" : ""}${percent.toFixed(2)}%`;
  } catch {
    return "--";
  }
}
