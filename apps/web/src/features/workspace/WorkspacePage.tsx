import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Pause, Play, RefreshCw, ShieldAlert } from "lucide-react";
import { Decimal } from "decimal.js";
import type { PageId } from "../../app/navigation.js";
import { pages } from "../../app/navigation.js";
import { DataTable } from "../../components/terminal/DataTable.js";
import { ConfirmDialog } from "../../components/terminal/ConfirmDialog.js";
import { StatusBadge } from "../../components/terminal/StatusBadge.js";
import {
  ApiError,
  engageKillSwitch,
  getDashboard,
  getWorkspaceSummary,
  type MarketInstrument,
  pauseStrategy,
  resumeStrategy
} from "../../lib/api-client.js";
import { useTerminalStore } from "../../lib/terminal-store.js";
import { formatTime, formatUsd, formatSignedUsd } from "../../lib/format.js";
import { MarketChart } from "../dashboard/MarketChart.js";
import { SystemHealthPanel } from "../dashboard/SystemHealthPanel.js";
import { age, sampleFresh } from "../dashboard/health-model.js";
import { activity, openOrders, uncertainOrders } from "./workspace-model.js";

type Action = { kind: "kill" } | { kind: "pause" | "resume"; strategyId: string };
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
  onSymbol
}: {
  view: Exclude<PageId, "backtests">;
  timeframe: string;
  onTimeframe: (value: string) => void;
  symbol: string;
  instruments: readonly MarketInstrument[];
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
        (action.kind !== "pause" && confirmation !== (action.kind === "kill" ? "STOP" : "RESUME"))
      )
        throw new Error("Confirmation required");
      if (action.kind === "kill") return engageKillSwitch(reason.trim());
      return action.kind === "pause"
        ? pauseStrategy(action.strategyId, reason.trim())
        : resumeStrategy(action.strategyId, reason.trim());
    },
    onSuccess: () => setAction(null),
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
          [`Managed ${symbol.replace(/USDT$/, "")} quantity`, position?.quantity ?? "--"],
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
        [`Managed ${symbol.replace(/USDT$/, "")} position`, position?.quantity ?? "--"],
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
            "DB persisted trades / sampled",
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
      "Updated"
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
      formatTime(o.updatedAtMs)
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
          <span>{view === "market" ? `${symbol} / Binance Spot` : "Meridian / Testnet account"}</span>
        </div>
        {status(
          view === "market"
            ? marketFresh
              ? marketConnection
              : "Market stale"
            : accountFresh
              ? accountConnection
              : "Account stale"
        )}
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
                <MarketChart candles={market.candles} />
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
                <select value={symbol} onChange={(event) => onSymbol(event.target.value)}>
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
            <div className="main-market-chart">
              <MarketChart
                key={`${symbol}:${timeframe}`}
                candles={market.candles.filter((c) => c.interval === timeframe)}
              />
            </div>
            <Section title="Market data health" extra={refresh}>
              {marketHealth}
            </Section>
          </div>
          <aside>
            <Section title="Order book depth" extra={<small>Limited depth</small>}>
              <DataTable
                columns={["Side", "Price / USDT", "BTC"]}
                rows={
                  market.book
                    ? [
                        ...market.book.asks
                          .slice(0, 10)
                          .reverse()
                          .map((l) => [
                            <span className="negative">Ask</span>,
                            formatUsd(l.price),
                            l.quantity
                          ]),
                        [
                          "Spread",
                          new Decimal(market.book.asks[0]!.price)
                            .minus(market.book.bids[0]!.price)
                            .toFixed(2),
                          "USDT"
                        ],
                        ...market.book.bids
                          .slice(0, 10)
                          .map((l) => [
                            <span className="positive">Bid</span>,
                            formatUsd(l.price),
                            l.quantity
                          ])
                      ]
                    : []
                }
                emptyLabel="Book unavailable"
              />
            </Section>
            <Section title="Recent trade tape">
              <DataTable
                columns={["Time", "Side", "BTC", "Price"]}
                rows={market.trades
                  .slice(-20)
                  .reverse()
                  .map((t) => [
                    formatTime(t.time),
                    <span className={t.side === "buy" ? "positive" : "negative"}>{t.side}</span>,
                    t.quantity,
                    formatUsd(t.price)
                  ])}
                emptyLabel="No recent trades"
              />
            </Section>
          </aside>
        </div>
      )}
      {view === "trading" && (
        <>
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
                [`${symbol.replace(/USDT$/, "")} managed position`, position?.quantity ?? "--"],
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
            : action?.kind === "resume"
              ? "Confirm strategy resume"
              : "Pause strategy"
        }
        description={
          action?.kind === "resume"
            ? "Strategy execution may resume. The global kill switch remains unchanged."
            : action?.kind === "kill"
              ? "Block new execution globally. Existing orders follow executor cancellation handling."
              : "Pause this strategy."
        }
        confirmLabel={
          action?.kind === "resume"
            ? "Confirm resume"
            : action?.kind === "kill"
              ? "Engage kill switch"
              : "Confirm pause"
        }
        tone={action?.kind === "kill" ? "danger" : "primary"}
        busy={mutation.isPending}
        disabled={
          !operator ||
          !reason.trim() ||
          (action?.kind !== "pause" &&
            confirmation !== (action?.kind === "kill" ? "STOP" : "RESUME"))
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
            Type {action?.kind === "kill" ? "STOP" : "RESUME"} to confirm
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
