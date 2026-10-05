import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  CircleAlert,
  Database,
  FlaskConical,
  HardDrive,
  Layers,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Server,
  Waves
} from "lucide-react";
import { ColorType, createChart, type UTCTimestamp } from "lightweight-charts";
import { BacktestPreview } from "../features/backtests/BacktestPreview.js";

interface Trade {
  id: string;
  time: number;
  price: string;
  quantity: string;
  side: "buy" | "sell";
}
interface Snapshot {
  checkedAt: number;
  symbol: string;
  source: string;
  feed: "live" | "stale" | "waiting";
  trades: Trade[];
  redis: { available: boolean; count: number | null; memoryBytes: number | null };
  database: { available: boolean; count: number | null; checkedAt: number | null };
  recording: { bytes: number; updatedAt: number; path: string } | null;
  soak: {
    status: string;
    startedAt: number | null;
    elapsedMs: number;
    durationMs: number;
    progress: number;
    completed: boolean;
    hasErrors: boolean;
  };
}
const number = new Intl.NumberFormat("en-US");
const price = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const time = (value: number) => new Date(value).toLocaleTimeString("en-GB", { hour12: false });
const bytes = (value: number | null | undefined) =>
  value == null ? "--" : `${(value / 1_000_000).toFixed(1)} MB`;
const elapsed = (ms: number) =>
  `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
const count = (value: number | null | undefined) => (value == null ? "--" : number.format(value));

function PriceChart({ trades, mode }: { trades: Trade[]; mode: "price" | "volume" }) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart>>();
  const lineRef = useRef<ReturnType<ReturnType<typeof createChart>["addLineSeries"]>>();
  const volumeRef = useRef<ReturnType<ReturnType<typeof createChart>["addHistogramSeries"]>>();
  const [reset, setReset] = useState(0);
  useEffect(() => {
    if (!container.current) return;
    const chart = createChart(container.current, {
      autoSize: true,
      height: 290,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#7c8583",
        fontFamily: "'Segoe UI', sans-serif",
        fontSize: 11
      },
      grid: { vertLines: { visible: false }, horzLines: { color: "#edf0ee" } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: true },
      crosshair: {
        vertLine: { color: "#b6c5bf", labelBackgroundColor: "#263e34" },
        horzLine: { color: "#b6c5bf", labelBackgroundColor: "#263e34" }
      }
    });
    chartRef.current = chart;
    lineRef.current = chart.addLineSeries({ color: "#18875b", lineWidth: 2 });
    volumeRef.current = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      visible: false
    });
    return () => {
      chart.remove();
      chartRef.current = undefined;
    };
  }, []);
  useEffect(() => {
    const points = new Map<number, { price: number; volume: number; side: string }>();
    for (const trade of trades) {
      const second = Math.floor(trade.time / 1000);
      points.set(second, {
        price: Number(trade.price),
        volume: (points.get(second)?.volume ?? 0) + Number(trade.quantity),
        side: trade.side
      });
    }
    const sorted = [...points].sort((a, b) => a[0] - b[0]);
    lineRef.current?.setData(
      sorted.map(([second, point]) => ({ time: second as UTCTimestamp, value: point.price }))
    );
    volumeRef.current?.setData(
      sorted.map(([second, point]) => ({
        time: second as UTCTimestamp,
        value: point.volume,
        color: point.side === "buy" ? "#93cfb3" : "#eeaca0"
      }))
    );
    lineRef.current?.applyOptions({ visible: mode === "price" });
    volumeRef.current?.applyOptions({ visible: mode === "volume" });
    chartRef.current?.timeScale().fitContent();
  }, [trades, mode, reset]);
  return (
    <div className="chart-wrap">
      <div
        ref={container}
        className="chart"
        aria-label={
          mode === "price" ? "Live BTCUSDT trade price chart" : "BTCUSDT recent trade volume chart"
        }
      />
      {trades.length === 0 && <div className="chart-empty">Waiting for market data</div>}
      <button
        className="chart-reset icon-button"
        title="Reset chart view"
        aria-label="Reset chart view"
        onClick={() => setReset((value) => value + 1)}
      >
        <RefreshCw size={14} />
      </button>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
  icon
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <div className="metric">
      <div className="metric-label">
        {label}
        {icon}
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

export function App() {
  const [paused, setPaused] = useState(false);
  const [view, setView] = useState<"market" | "system" | "backtests">("market");
  const [mode, setMode] = useState<"price" | "volume">("price");
  const [side, setSide] = useState("all");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const query = useQuery<Snapshot>({
    queryKey: ["dashboard"],
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/dashboard", {
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)])
      });
      if (!response.ok) throw new Error("Dashboard API unavailable");
      return response.json();
    },
    refetchInterval: paused ? false : 2000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: !paused,
    enabled: view !== "backtests",
    retry: 1
  });
  const data = query.data;
  const trades = data?.trades ?? [];
  const latest = trades.at(-1);
  const stale = Boolean(
    query.isError ||
    (data && now - data.checkedAt > 10_000) ||
    (latest && now - latest.time > 15_000)
  );
  const live = Boolean(view !== "backtests" && !paused && !stale && data?.feed === "live");
  const status = view === "backtests"
    ? "Preview"
    : paused
    ? "Paused"
    : query.isError
      ? "Disconnected"
      : data?.redis.available === false
        ? "Unavailable"
        : stale
          ? "Stale data"
          : live
            ? "Live"
            : "Connecting";
  const firstPrice = trades[0] ? Number(trades[0].price) : null;
  const change = latest && firstPrice ? (Number(latest.price) / firstPrice - 1) * 100 : null;
  const buyVolume = trades
    .filter((trade) => trade.side === "buy")
    .reduce((sum, trade) => sum + Number(trade.quantity), 0);
  const totalVolume = trades.reduce((sum, trade) => sum + Number(trade.quantity), 0);
  const buyShare = totalVolume > 0 ? (buyVolume / totalVolume) * 100 : 0;
  const soak = data?.soak;
  const visibleTrades = [...trades]
    .reverse()
    .filter((trade) => side === "all" || trade.side === side)
    .slice(0, 30);
  const soakState = !data
    ? "Waiting"
    : soak?.hasErrors
      ? "Needs attention"
      : soak?.completed
        ? "Finished · review pending"
        : stale
          ? "Check connection"
          : soak?.status === "running"
            ? "Running"
            : "Needs attention";
  const pipeline = (
    <>
      <PipelineRow label="Binance trade feed" healthy={live} detail={status} />
      <PipelineRow
        label="Redis Streams"
        healthy={Boolean(!stale && data?.redis.available)}
        detail={data?.redis.available ? "Connected" : "Unavailable"}
      />
      <PipelineRow
        label="TimescaleDB"
        healthy={Boolean(!stale && data?.database.available)}
        detail={data?.database.available ? "Connected" : "Unavailable"}
      />
      <PipelineRow
        label="Session recorder"
        healthy={Boolean(!stale && data?.recording && now - data.recording.updatedAt < 15_000)}
        detail={
          data?.recording
            ? `${Math.max(0, Math.floor((now - data.recording.updatedAt) / 1000))}s since write`
            : "Not found"
        }
      />
    </>
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Meridian home">
          <Waves size={26} />
          <span>
            meridian<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="workspace-label">LOCAL WORKSPACE</div>
        <nav aria-label="Primary">
          <button
            className={view === "market" ? "nav-item active" : "nav-item"}
            onClick={() => setView("market")}
          >
            <ChartNoAxesCombined size={18} />
            Market overview
            <ChevronRight size={14} />
          </button>
          <button
            className={view === "system" ? "nav-item active" : "nav-item"}
            onClick={() => setView("system")}
          >
            <Server size={18} />
            System health
            <ChevronRight size={14} />
          </button>
          <button
            className={view === "backtests" ? "nav-item active" : "nav-item"}
            onClick={() => setView("backtests")}
          >
            <FlaskConical size={18} />
            Strategy Lab
            <ChevronRight size={14} />
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="source-mark">
            <Radio size={18} />
            <div>
              Binance Spot<small>Public market feed</small>
            </div>
          </div>
          <div className="readonly">
            <span className="dot" />
            Read-only · no order execution
          </div>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <span>
              {view === "market"
                ? "Market overview"
                : view === "system"
                  ? "System health"
                  : "Strategy Lab"}
            </span>
          </div>
          <div className="topbar-right">
            <span className="local-label">LOCAL</span>
            <span className="clock">{time(now)}</span>
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {view === "backtests" ? "BACKTESTS / PHASE 2.4" : "MARKET DATA / PHASE 1.5"}
              </div>
              <h1>
                {view === "market"
                  ? "Market overview"
                  : view === "system"
                    ? "System health"
                    : "Strategy Lab"}
              </h1>
            </div>
            <div className="heading-actions">
              <span className={`status-pill ${live ? "healthy" : "warning"}`}>
                <span className="dot" />
                {status}
              </span>
              <button
                className="icon-button"
                title={paused ? "Resume live updates" : "Pause dashboard updates"}
                aria-label={paused ? "Resume live updates" : "Pause dashboard updates"}
                onClick={() => setPaused((value) => !value)}
              >
                {paused ? <Play size={16} /> : <Pause size={16} />}
              </button>
              <button
                className="icon-button"
                title="Refresh dashboard"
                aria-label="Refresh dashboard"
                disabled={query.isFetching}
                onClick={() => {
                  void query.refetch();
                }}
              >
                <RefreshCw size={16} className={query.isFetching ? "spinning" : ""} />
              </button>
            </div>
          </div>
          {view === "backtests" && <BacktestPreview />}
          {view !== "backtests" && query.isError && (
            <div className="alert" role="alert">
              <CircleAlert size={17} />
              Dashboard connection lost. Last known values may be outdated.
            </div>
          )}
          {view !== "backtests" && paused && (
            <div className="alert">
              <Pause size={16} />
              Dashboard updates paused. Ingestion continues.
            </div>
          )}
          {view !== "backtests" && (
            <section className="metrics" aria-label="Ingestion metrics">
              <Metric
                label="Redis stream entries"
                value={count(data?.redis.count)}
                detail={
                  data?.redis.available === false ? "Redis unavailable" : "BTCUSDT · cumulative"
                }
                icon={<Layers size={16} />}
              />
              <Metric
                label="Persisted trades"
                value={count(data?.database.count)}
                detail={
                  data?.database.available === false
                    ? "Timescale unavailable"
                    : "TimescaleDB · checked every 15s"
                }
                icon={<Database size={16} />}
              />
              <Metric
                label="Session recording"
                value={bytes(data?.recording?.bytes)}
                detail={data?.recording ? "NDJSON · saved to disk" : "Recording not found"}
                icon={<HardDrive size={16} />}
              />
              <Metric
                label="Redis memory"
                value={bytes(data?.redis.memoryBytes)}
                detail="Current Redis allocation"
                icon={<Activity size={16} />}
              />
            </section>
          )}
          {view === "market" && (
            <>
              <section className="market-panel" aria-label="BTCUSDT market">
                <div className="market-header">
                  <div className="instrument">
                    <div className="coin">₿</div>
                    <div>
                      <h2>BTC / USDT</h2>
                      <span>
                        Bitcoin <span className="muted-dot">·</span> Binance Spot
                      </span>
                    </div>
                  </div>
                  <div className="quote">
                    <strong>{latest ? `$${price.format(Number(latest.price))}` : "--"}</strong>
                    <span className={change !== null && change < 0 ? "sell" : "buy"}>
                      {change === null
                        ? "Waiting for trades"
                        : `${change >= 0 ? "+" : ""}${change.toFixed(3)}% in sample`}
                    </span>
                  </div>
                </div>
                <div className="chart-toolbar">
                  <span>
                    <span className={`dot ${live ? "green" : "amber"}`} />
                    Recent trade {mode === "price" ? "price" : "volume"}
                    <small>Latest {trades.length} events · UTC chart</small>
                  </span>
                  <div className="segmented" aria-label="Chart mode">
                    <button
                      className={mode === "price" ? "selected" : ""}
                      onClick={() => setMode("price")}
                    >
                      Price
                    </button>
                    <button
                      className={mode === "volume" ? "selected" : ""}
                      onClick={() => setMode("volume")}
                    >
                      Volume
                    </button>
                  </div>
                </div>
                <PriceChart trades={trades} mode={mode} />
                <div className="market-footer">
                  <span>
                    Last trade <b>{latest ? time(latest.time) : "--"}</b>
                  </span>
                  <span>
                    Sample volume <b>{totalVolume.toFixed(5)} BTC</b>
                  </span>
                  <span>
                    Events in view <b>{count(trades.length)}</b>
                  </span>
                </div>
              </section>
              <div className="lower-grid">
                <section className="trades-section">
                  <div className="section-heading">
                    <h2>
                      Recent trades<span className="subtle-count">{visibleTrades.length}</span>
                    </h2>
                    <select
                      aria-label="Filter trade side"
                      value={side}
                      onChange={(event) => setSide(event.target.value)}
                    >
                      <option value="all">All sides</option>
                      <option value="buy">Buy</option>
                      <option value="sell">Sell</option>
                    </select>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Price (USDT)</th>
                          <th>Quantity (BTC)</th>
                          <th>Side</th>
                          <th>Trade ID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleTrades.map((trade) => (
                          <tr key={trade.id}>
                            <td>{time(trade.time)}</td>
                            <td className={trade.side}>{price.format(Number(trade.price))}</td>
                            <td>{trade.quantity}</td>
                            <td>
                              <span className={`trade-side ${trade.side}`}>
                                {trade.side === "buy" ? (
                                  <ArrowUpRight size={12} />
                                ) : (
                                  <ArrowDownLeft size={12} />
                                )}
                                {trade.side}
                              </span>
                            </td>
                            <td className="trade-id">{trade.id}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {visibleTrades.length === 0 && (
                      <div className="empty-table">
                        {query.isError ? "Market data unavailable" : "Waiting for trades"}
                      </div>
                    )}
                  </div>
                </section>
                <div className="right-column">
                  <section className="flow-section">
                    <div className="section-heading">
                      <h2>Trade flow</h2>
                      <span className="muted">Sample</span>
                    </div>
                    <div className="flow-values">
                      <div>
                        <small>Taker buys</small>
                        <strong className="buy">{totalVolume ? buyShare.toFixed(1) : "--"}%</strong>
                      </div>
                      <div>
                        <small>Taker sells</small>
                        <strong className="sell">
                          {totalVolume ? (100 - buyShare).toFixed(1) : "--"}%
                        </strong>
                      </div>
                    </div>
                    <div className="flow-bar">
                      <span style={{ width: `${buyShare}%` }} />
                    </div>
                    <div className="flow-caption">
                      {totalVolume.toFixed(5)} BTC across {trades.length} recent trades
                    </div>
                  </section>
                  <SoakPanel soak={soak} state={soakState} />
                  <section className="pipeline-section">
                    <div className="section-heading">
                      <h2>Data pipeline</h2>
                    </div>
                    {pipeline}
                  </section>
                </div>
              </div>
            </>
          )}
          {view === "system" && (
            <div className="system-layout">
              <section>
                <div className="section-heading">
                  <h2>Pipeline status</h2>
                </div>
                {pipeline}
                <div className="system-details">
                  <span>Recording file</span>
                  <code>{data?.recording?.path ?? "Not found"}</code>
                  <span>Database last checked</span>
                  <b>
                    {data?.database.checkedAt
                      ? new Date(data.database.checkedAt).toLocaleString()
                      : "--"}
                  </b>
                  <span>Latest market event</span>
                  <b>{latest ? new Date(latest.time).toLocaleString() : "--"}</b>
                  <span>Ingestor error log</span>
                  <b>
                    {soak
                      ? soak.hasErrors
                        ? "Errors present · review required"
                        : "No errors logged"
                      : "--"}
                  </b>
                  <span>Redis memory cap</span>
                  <b>Not configured</b>
                </div>
              </section>
              <SoakPanel soak={soak} state={soakState} />
            </div>
          )}
          {view !== "backtests" && (
            <footer className="page-footer">
              <span>
                <span className="dot" />
                Binance public market data · BTCUSDT
              </span>
              <span>
                {data ? `Last checked ${time(data.checkedAt)}` : "Awaiting first snapshot"}
              </span>
            </footer>
          )}
        </div>
      </main>
    </div>
  );
}

function PipelineRow({
  label,
  healthy,
  detail
}: {
  label: string;
  healthy: boolean;
  detail: string;
}) {
  return (
    <div className="pipeline-row">
      <span className={`pipeline-icon ${healthy ? "healthy" : "warning"}`}>
        {healthy ? <Check size={12} /> : <CircleAlert size={12} />}
      </span>
      <span>{label}</span>
      <small>{detail}</small>
    </div>
  );
}

function SoakPanel({ soak, state }: { soak: Snapshot["soak"] | undefined; state: string }) {
  return (
    <section className="soak-section">
      <div className="section-heading">
        <h2>24-hour soak</h2>
        <span className="phase-label">1.5</span>
      </div>
      <div className="soak-value">
        <strong>{soak?.startedAt ? elapsed(soak.elapsedMs) : "--"}</strong>
        <span>/ 24h</span>
      </div>
      <progress max={1} value={soak?.progress ?? 0} aria-label="24-hour soak elapsed time" />
      <div className="soak-caption">
        <span>{state}</span>
        <b>{soak ? `${(soak.progress * 100).toFixed(1)}% elapsed` : "--"}</b>
      </div>
      <div className="soak-dates">
        <span>
          Started
          <b>
            {soak?.startedAt
              ? new Date(soak.startedAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit"
                })
              : "--"}
          </b>
        </span>
        <span>
          24h mark
          <b>
            {soak?.startedAt
              ? new Date(soak.startedAt + soak.durationMs).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit"
                })
              : "--"}
          </b>
        </span>
      </div>
    </section>
  );
}
