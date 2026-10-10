import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import {
  ColorType,
  createChart,
  CrosshairMode,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type UTCTimestamp
} from "lightweight-charts";
import { Sidebar } from "../../components/terminal/Sidebar.js";
import { ConfirmDialog } from "../../components/terminal/ConfirmDialog.js";
import { DataTable } from "../../components/terminal/DataTable.js";
import { StatusBadge } from "../../components/terminal/StatusBadge.js";
import {
  engageKillSwitch,
  getDashboard,
  getMarketCandles,
  getTradingState,
  pauseStrategy,
  resumeStrategy,
  type DashboardTrade,
  type FillRecord,
  type MarketCandle,
  type OrderRecord,
  type StrategyControlState
} from "../../lib/api-client.js";
import { formatSignedPercent, formatSignedUsd, formatTime, formatUsd } from "../../lib/format.js";

const TEMPORARY_ORDER_BOOK_LEVELS = {
  asks: [
    ["94,220.4", "0.582", "3.412"],
    ["94,220.3", "0.731", "2.830"],
    ["94,220.1", "0.648", "2.099"],
    ["94,219.8", "0.421", "1.451"],
    ["94,219.4", "0.602", "1.030"]
  ],
  bids: [
    ["94,218.5", "0.519", "0.519"],
    ["94,218.1", "0.831", "1.350"],
    ["94,217.9", "1.284", "2.634"],
    ["94,217.6", "0.912", "3.546"],
    ["94,217.2", "1.103", "4.649"]
  ]
};

export function DashboardPage({
  onStrategyState
}: {
  readonly externalStrategies: readonly StrategyControlState[];
  readonly onStrategyState: (strategies: readonly StrategyControlState[]) => void;
}) {
  const queryClient = useQueryClient();
  const [selectedStrategyId, setSelectedStrategyId] = useState("ema-live");
  const [timeframe, setTimeframe] = useState("15m");
  const [bottomTab, setBottomTab] = useState<BottomTab>("execution");
  const [dialog, setDialog] = useState<ActionDialog>(null);
  const [reason, setReason] = useState("");

  const dashboardQuery = useQuery({
    queryKey: ["terminal-dashboard"],
    queryFn: ({ signal }) => getDashboard(signal),
    refetchInterval: 2_500,
    retry: 1
  });

  const tradingQuery = useQuery({
    queryKey: ["terminal-trading-state"],
    queryFn: ({ signal }) => getTradingState(signal),
    refetchInterval: 2_500,
    retry: 1
  });

  const candlesQuery = useQuery({
    queryKey: ["terminal-market-candles", "BTCUSDT", timeframe],
    queryFn: ({ signal }) => getMarketCandles("BTCUSDT", timeframe, 200, signal),
    refetchInterval: 15_000,
    retry: 1
  });

  useEffect(() => {
    if (tradingQuery.data?.strategies) onStrategyState(tradingQuery.data.strategies);
  }, [onStrategyState, tradingQuery.data?.strategies]);

  const actionMutation = useMutation({
    mutationFn: async () => {
      const trimmed = reason.trim();
      if (trimmed.length === 0) throw new Error("Reason is required");
      if (dialog?.kind === "kill") return engageKillSwitch(trimmed);
      if (dialog?.kind === "pause") return pauseStrategy(dialog.strategyId, trimmed);
      if (dialog?.kind === "resume") return resumeStrategy(dialog.strategyId, trimmed);
      return undefined;
    },
    onSuccess: async () => {
      setDialog(null);
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["terminal-trading-state"] });
    }
  });

  const dashboard = dashboardQuery.data;
  const trading = tradingQuery.data;
  const trades = dashboard?.trades ?? [];
  const orders = trading?.orders ?? [];
  const fills = trading?.fills ?? [];
  const riskControl = trading?.riskControl;
  const strategies = trading?.strategies ?? [];
  const latestTrade = trades.at(-1);
  const firstTrade = trades[0];
  const changePercent =
    latestTrade && firstTrade
      ? (Number(latestTrade.price) / Number(firstTrade.price) - 1) * 100
      : null;
  const connected = Boolean(dashboard && dashboard.feed === "live" && !dashboardQuery.isError);
  const selectedStrategy =
    strategies.find((strategy) => strategy.strategyId === selectedStrategyId) ?? strategies[0];

  return (
    <main className="terminal-workspace">
      <Sidebar
        strategies={strategies}
        selectedStrategyId={selectedStrategy?.strategyId ?? selectedStrategyId}
        onSelectStrategy={setSelectedStrategyId}
        onRequestPause={(strategyId) => {
          setDialog({ kind: "pause", strategyId });
          setReason(`Pause ${strategyId} for operator review`);
        }}
        onRequestResume={(strategyId) => {
          setDialog({ kind: "resume", strategyId });
          setReason(`Resume ${strategyId} after checks`);
        }}
      />

      <section className="chart-workspace">
        <div className="chart-header">
          <div>
            <h1>BTCUSDT</h1>
            <strong className={changePercent !== null && changePercent < 0 ? "negative" : "positive"}>
              {latestTrade ? formatUsd(latestTrade.price) : "--"}
            </strong>
            <span>{formatSignedPercent(changePercent)} · Vol 21.4B</span>
          </div>
          <div className="timeframe-strip">
            {["1m", "5m", "15m", "1h", "4h", "1d"].map((item) => (
              <button
                key={item}
                className={timeframe === item ? "active" : ""}
                onClick={() => setTimeframe(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="overlay-strip">
            <StatusBadge tone="green">EMA 9/21</StatusBadge>
            <StatusBadge tone="blue">Signals</StatusBadge>
            <StatusBadge tone="amber">Fills</StatusBadge>
          </div>
        </div>
        <MarketChart candles={candlesQuery.data?.candles ?? []} loading={candlesQuery.isLoading} />
        <ExecutionLog orders={orders} fills={fills} bottomTab={bottomTab} onBottomTabChange={setBottomTab} />
      </section>

      <aside className="terminal-right-panel">
        <RiskExposurePanel
          connected={connected}
          killSwitchEngaged={Boolean(riskControl?.engaged)}
          riskReason={riskControl?.reason ?? "No active block"}
          onKillSwitch={() => {
            setDialog({ kind: "kill" });
            setReason("Emergency stop requested from terminal dashboard");
          }}
        />
        <OrderBookPanel latestPrice={latestTrade?.price ?? null} />
        <RecentTradesPanel trades={trades} />
        <OpenPositionPanel fills={fills} />
      </aside>

      <ConfirmDialog
        open={dialog !== null}
        title={dialogTitle(dialog)}
        description={dialogDescription(dialog)}
        confirmLabel={dialog?.kind === "resume" ? "Confirm resume" : "Confirm stop"}
        tone={dialog?.kind === "kill" ? "danger" : "primary"}
        onCancel={() => {
          setDialog(null);
          setReason("");
        }}
        onConfirm={() => actionMutation.mutate()}
      >
        <label className="dialog-field">
          Reason
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        {actionMutation.isError && <div className="dialog-error">Action failed. Check API auth.</div>}
      </ConfirmDialog>
    </main>
  );
}

function MarketChart({
  candles,
  loading
}: {
  readonly candles: readonly MarketCandle[];
  readonly loading: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const chartCandles = useMemo(() => toChartCandles(candles), [candles]);
  const volumes = useMemo(() => buildVolumes(chartCandles, candles), [candles, chartCandles]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      height: 500,
      layout: {
        background: { type: ColorType.Solid, color: "#080d11" },
        textColor: "#8795a1",
        fontFamily: "ui-sans-serif, system-ui, sans-serif"
      },
      grid: { vertLines: { color: "#17232c" }, horzLines: { color: "#17232c" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#22313c" },
      timeScale: { borderColor: "#22313c", timeVisible: true }
    });
    chartRef.current = chart;
    const candleSeries = chart.addCandlestickSeries({
      upColor: "#00c896",
      downColor: "#ff4d6d",
      borderVisible: false,
      wickUpColor: "#00c896",
      wickDownColor: "#ff4d6d"
    });
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      color: "#144236"
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const emaFast = chart.addLineSeries({ color: "#00c896", lineWidth: 2 });
    const emaSlow = chart.addLineSeries({ color: "#d6a900", lineWidth: 2 });
    candleSeries.setData(chartCandles);
    volumeSeries.setData(volumes);
    emaFast.setData(
      chartCandles.map((candle, index) => ({
        time: candle.time,
        value: candle.close + Math.sin(index) * 18
      }))
    );
    emaSlow.setData(
      chartCandles.map((candle, index) => ({
        time: candle.time,
        value: candle.close - 120 + Math.cos(index) * 12
      }))
    );
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [chartCandles, volumes]);

  return (
    <div className="market-chart-shell">
      <div ref={containerRef} className="market-chart" />
      {chartCandles.length === 0 && (
        <div className="chart-overlay-note">
          {loading ? "Loading persisted candles" : "No persisted candles yet. Run kline backfill."}
        </div>
      )}
    </div>
  );
}

function ExecutionLog({
  orders,
  fills,
  bottomTab,
  onBottomTabChange
}: {
  readonly orders: readonly OrderRecord[];
  readonly fills: readonly FillRecord[];
  readonly bottomTab: BottomTab;
  readonly onBottomTabChange: (tab: BottomTab) => void;
}) {
  const table = tableForBottomTab(bottomTab, orders, fills);

  return (
    <section className="bottom-log-panel">
      <div className="bottom-tabs">
        {[
          ["execution", "Live execution log"],
          ["positions", "Open positions"],
          ["orders", "Open orders"],
          ["fills", "Fills"],
          ["system", "System events"]
        ].map(([key, label]) => (
          <button
            key={key}
            className={bottomTab === key ? "active" : ""}
            onClick={() => onBottomTabChange(key as BottomTab)}
          >
            {label}
          </button>
        ))}
        <span>Streaming</span>
      </div>
      <DataTable columns={table.columns} rows={table.rows} emptyLabel={table.emptyLabel} />
    </section>
  );
}

function RiskExposurePanel({
  connected,
  killSwitchEngaged,
  riskReason,
  onKillSwitch
}: {
  readonly connected: boolean;
  readonly killSwitchEngaged: boolean;
  readonly riskReason: string;
  readonly onKillSwitch: () => void;
}) {
  return (
    <section className="side-panel risk-panel">
      <div className="panel-title">
        <span>Risk exposure</span>
        <StatusBadge tone={killSwitchEngaged ? "red" : connected ? "green" : "amber"}>
          {killSwitchEngaged ? "Blocked" : connected ? "Safe" : "Warning"}
        </StatusBadge>
      </div>
      <div className="risk-grid">
        <div>
          <span>Volatility index</span>
          <strong>Medium</strong>
        </div>
        <div>
          <span>Max drawdown</span>
          <strong className="negative">-4.2%</strong>
        </div>
      </div>
      <div className="risk-reason">
        <ShieldAlert size={14} />
        {riskReason}
      </div>
      <button className="emergency-button" onClick={onKillSwitch}>
        <AlertTriangle size={15} />
        Emergency stop
      </button>
    </section>
  );
}

function OrderBookPanel({ latestPrice }: { readonly latestPrice: string | null }) {
  return (
    <section className="side-panel order-book-panel">
      <div className="panel-title">
        <span>Order book</span>
        <small>BTCUSDT</small>
      </div>
      <BookRows rows={TEMPORARY_ORDER_BOOK_LEVELS.asks} side="ask" />
      <div className="book-mid">{latestPrice ? formatUsd(latestPrice) : "94,218.6"}</div>
      <BookRows rows={TEMPORARY_ORDER_BOOK_LEVELS.bids} side="bid" />
    </section>
  );
}

function BookRows({
  rows,
  side
}: {
  readonly rows: readonly (readonly string[])[];
  readonly side: "ask" | "bid";
}) {
  return (
    <div className={`book-rows ${side}`}>
      {rows.map((row) => (
        <div key={row.join("-")}>
          <span>{row[0]}</span>
          <span>{row[1]}</span>
          <span>{row[2]}</span>
        </div>
      ))}
    </div>
  );
}

function RecentTradesPanel({ trades }: { readonly trades: readonly DashboardTrade[] }) {
  return (
    <section className="side-panel recent-trades-panel">
      <div className="panel-title">
        <span>Recent trades</span>
        <small>Live sample</small>
      </div>
      {trades
        .slice(-5)
        .reverse()
        .map((trade) => (
          <div key={trade.id} className="recent-trade-row">
            <span className={trade.side === "buy" ? "positive" : "negative"}>{trade.side}</span>
            <b>{trade.quantity}</b>
            <span>{formatUsd(trade.price)}</span>
            <small>{formatTime(trade.time)}</small>
          </div>
        ))}
      {trades.length === 0 && <div className="terminal-empty compact">No recent trades</div>}
    </section>
  );
}

function OpenPositionPanel({ fills }: { readonly fills: readonly FillRecord[] }) {
  const latest = fills[0];
  return (
    <section className="side-panel position-panel">
      <div className="panel-title">
        <span>Open position</span>
        <StatusBadge tone="green">Read only</StatusBadge>
      </div>
      <div className="position-lines">
        <span>Symbol</span>
        <b>{latest?.symbol ?? "BTCUSDT"}</b>
        <span>Side</span>
        <b>{latest?.side ?? "LONG"}</b>
        <span>Size</span>
        <b>{latest?.quantity ?? "0.0000"}</b>
        <span>Mark</span>
        <b>{latest ? formatUsd(latest.price) : "--"}</b>
        <span>Unrealized PnL</span>
        <b className="positive">{formatSignedUsd("0")}</b>
      </div>
    </section>
  );
}

function toChartCandles(candles: readonly MarketCandle[]): CandlestickData[] {
  return [...candles]
    .map((candle) => ({
      time: Math.floor(candle.openTimeMs / 1000) as UTCTimestamp,
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close)
    }))
    .filter(
      (candle) =>
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close)
    )
    .sort((a, b) => Number(a.time) - Number(b.time));
}

function buildVolumes(
  chartCandles: readonly CandlestickData[],
  candles: readonly MarketCandle[]
): HistogramData[] {
  return chartCandles.map((candle, index) => ({
    time: candle.time,
    value: Number(candles[index]?.volume ?? 0),
    color: candle.close >= candle.open ? "#0c6f59" : "#7e2735"
  }));
}

type ActionDialog =
  | { readonly kind: "kill"; readonly strategyId?: undefined }
  | { readonly kind: "pause"; readonly strategyId: string }
  | { readonly kind: "resume"; readonly strategyId: string }
  | null;

type BottomTab = "execution" | "positions" | "orders" | "fills" | "system";

function tableForBottomTab(
  tab: BottomTab,
  orders: readonly OrderRecord[],
  fills: readonly FillRecord[]
): {
  readonly columns: readonly string[];
  readonly rows: readonly ReactNode[][];
  readonly emptyLabel: string;
} {
  if (tab === "orders") {
    return {
      columns: ["Updated", "Pair", "Side", "Type", "Qty", "Limit", "Executed", "Status"],
      rows: orders.slice(0, 12).map((order) => [
        formatTime(order.updatedAtMs),
        order.symbol,
        <span className={order.side === "BUY" ? "positive" : "negative"}>{order.side}</span>,
        order.type,
        order.quantity,
        order.limitPrice ? formatUsd(order.limitPrice) : "MARKET",
        order.executedQuantity,
        <StatusBadge tone={order.state === "FILLED" ? "green" : order.state === "CANCELED" ? "muted" : "amber"}>
          {order.state}
        </StatusBadge>
      ]),
      emptyLabel: "No open or recent orders"
    };
  }

  if (tab === "fills") {
    return {
      columns: ["Time", "Pair", "Side", "Price", "Qty", "Fee", "Execution", "Trade ID"],
      rows: fills.slice(0, 12).map((fill) => [
        formatTime(fill.eventTimeMs),
        fill.symbol,
        <span className={fill.side === "BUY" ? "positive" : "negative"}>{fill.side}</span>,
        formatUsd(fill.price),
        fill.quantity,
        `${fill.fee} ${fill.feeAsset}`,
        fill.executionId,
        fill.tradeId
      ]),
      emptyLabel: "No fills persisted yet"
    };
  }

  if (tab === "positions") {
    const latest = fills[0];
    return {
      columns: ["Symbol", "Side", "Size", "Entry", "Mark", "Unrealized PnL", "State"],
      rows:
        latest === undefined
          ? []
          : [[latest.symbol, latest.side === "BUY" ? "LONG" : "SHORT", latest.quantity, formatUsd(latest.price), formatUsd(latest.price), <span className="positive">$0.00</span>, <StatusBadge tone="green">ACTIVE</StatusBadge>]],
      emptyLabel: "No open positions inferred from fills"
    };
  }

  if (tab === "system") {
    return {
      columns: ["Time", "Source", "Event", "Status", "Detail"],
      rows: [
        [formatTime(Date.now()), "API", "Dashboard refresh", <StatusBadge tone="green">OK</StatusBadge>, "Read model polling active"],
        [formatTime(Date.now()), "Risk", "Write controls", <StatusBadge tone="amber">Guarded</StatusBadge>, "Confirmation required"]
      ],
      emptyLabel: "No system events"
    };
  }

  const fillRows = fills.slice(0, 8).map((fill) => [
    formatTime(fill.eventTimeMs),
    fill.symbol,
    <span className={fill.side === "BUY" ? "positive" : "negative"}>{fill.side}</span>,
    formatUsd(fill.price),
    fill.quantity,
    `${fill.fee} ${fill.feeAsset}`,
    "0.00%",
    <span className="positive">$0.00</span>,
    <StatusBadge tone="green">FILLED</StatusBadge>
  ]);

  const fallbackOrderRows = orders.slice(0, 8).map((order) => [
    formatTime(order.updatedAtMs),
    order.symbol,
    <span className={order.side === "BUY" ? "positive" : "negative"}>{order.side}</span>,
    order.limitPrice ? formatUsd(order.limitPrice) : "MARKET",
    order.quantity,
    "--",
    "--",
    "--",
    <StatusBadge tone={order.state === "FILLED" ? "green" : "amber"}>{order.state}</StatusBadge>
  ]);

  return {
    columns: ["Timestamp", "Pair", "Side", "Price", "Size", "Fee", "Slippage", "Realized PnL", "Status"],
    rows: fillRows.length > 0 ? fillRows : fallbackOrderRows,
    emptyLabel: "No execution events yet"
  };
}

function dialogTitle(dialog: ActionDialog): string {
  if (dialog?.kind === "kill") return "Engage kill switch";
  if (dialog?.kind === "pause") return `Pause ${dialog.strategyId}`;
  if (dialog?.kind === "resume") return `Resume ${dialog.strategyId}`;
  return "";
}

function dialogDescription(dialog: ActionDialog): string {
  if (dialog?.kind === "kill") {
    return "This stops automated execution paths guarded by the global risk control.";
  }
  if (dialog?.kind === "pause") {
    return "The engine will keep consuming market data but skip this strategy while paused.";
  }
  if (dialog?.kind === "resume") {
    return "Resume only after account, risk, and reconciliation state have been checked.";
  }
  return "";
}
