import { useEffect, useRef } from "react";
import { Activity, ArrowRight, ArrowUpRight, Layers3, ShieldCheck, ShieldOff } from "lucide-react";
import { useTerminalStore } from "../../lib/terminal-store.js";
import { formatSignedPercent, formatSignedUsd, formatTime, formatUsd } from "../../lib/format.js";
import { age, sampleFresh } from "../dashboard/health-model.js";
import { MarketChart } from "../dashboard/MarketChart.js";
import { activity, openOrders } from "./workspace-model.js";
import { usePageEntrance, type EntranceSequence } from "../../lib/use-page-entrance.js";
import { CandleInterval } from "./CandleInterval.js";
import "./overview.css";

const overviewEntrance: EntranceSequence = [
  [".ov-heading", 0, "translateX(-24px)"],
  ...Array.from({ length: 4 }, (_, index): [string, number, string] => [
    `.ov-metric:nth-child(${index + 1})`,
    60 + index * 50,
    "translateY(24px)"
  ]),
  [".ov-market", 220, "translateX(-32px)"],
  [".ov-execution", 280, "translateX(28px)"],
  [".ov-strategies", 340, "translateX(28px)"],
  [".ov-fills", 360, "translateY(24px)"],
  [".ov-connections", 400, "translateX(28px)"],
  [".ov-activity", 460, "translateY(24px)"]
];

function useStatusFeedback(status: string) {
  const element = useRef<HTMLElement>(null);
  const previous = useRef(status);
  const activeAnimation = useRef<Animation | null>(null);
  useEffect(() => {
    if (previous.current === status) return;
    previous.current = status;
    const node = element.current;
    if (!node || typeof node.animate !== "function") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const running = activeAnimation.current?.playState === "running";
    const current = running ? getComputedStyle(node) : null;
    const from = {
      opacity: current?.opacity ?? "0.55",
      transform: reduced ? "none" : (current?.transform ?? "translateY(2px)")
    };
    activeAnimation.current?.cancel();
    const animation = node.animate([from, { opacity: "1", transform: "none" }], {
      duration: reduced ? 125 : 160,
      easing: getComputedStyle(node).getPropertyValue("--ease-out").trim()
    });
    activeAnimation.current = animation;
    animation.onfinish = () => {
      if (activeAnimation.current === animation) activeAnimation.current = null;
    };
  }, [status]);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const settle = () => {
      if (preference.matches) activeAnimation.current?.cancel();
    };
    preference.addEventListener("change", settle);
    return () => {
      preference.removeEventListener("change", settle);
      activeAnimation.current?.cancel();
    };
  }, []);
  return element;
}

function ConnectionState({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone: "good" | "warning" | "muted";
}) {
  const statusRef = useStatusFeedback(`${value}:${tone}`);
  return (
    <div className="ov-connection">
      <dt>{label}</dt>
      <dd ref={statusRef}>
        <span className={`ov-dot ov-dot-${tone}`} aria-hidden="true" />
        {value}
      </dd>
    </div>
  );
}

export function OverviewContent({
  symbol,
  baseAsset,
  quoteAsset,
  timeframe,
  onTimeframe,
  now
}: {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  timeframe: string;
  onTimeframe: (value: string) => void;
  now: number;
}) {
  const entranceRef = usePageEntrance<HTMLDivElement>("overview", overviewEntrance);
  const { account, market, health, marketConnection, accountConnection, transport } =
    useTerminalStore();
  const accountFresh =
    accountConnection === "live" &&
    transport.account.lastReceivedAt !== null &&
    now - transport.account.lastReceivedAt <= 45000;
  const marketFresh =
    marketConnection === "live" && market.updatedAt !== null && now - market.updatedAt <= 15000;
  const healthFresh = sampleFresh(health, now);
  const control = account?.riskControl;
  const positions = account?.portfolio?.positions;
  const position = positions?.find((item) => item.symbol === symbol);
  const totals = account?.portfolio?.totals.find((item) => item.quoteAsset === quoteAsset);
  const walletBalance = account?.portfolio?.wallet?.assets.find(
    (item) => item.asset === quoteAsset
  )?.total;
  const equity = account?.portfolio?.equity;
  const orders = openOrders(account);
  const fills = [...(account?.fills ?? [])]
    .sort((a, b) => b.eventTimeMs - a.eventTimeMs)
    .slice(0, 5);
  const events = activity(account).slice(0, 6);
  const candle = market.candles.at(-1);
  const currentPrice = market.trades.at(-1)?.price ?? candle?.close;
  const candleChange =
    candle && candle.interval === timeframe && Number(candle.open) > 0
      ? (Number(candle.close) / Number(candle.open) - 1) * 100
      : null;
  const metrics = [
    {
      label: equity != null ? "Wallet equity" : `${quoteAsset} balance`,
      value: formatUsd(equity ?? walletBalance),
      unit: quoteAsset,
      detail:
        equity != null
          ? "Current wallet valuation"
          : walletBalance != null
            ? "Wallet balance · not total equity"
            : "Wallet data not available",
      tone: ""
    },
    {
      label: "Realized P/L",
      value: formatSignedUsd(totals?.realizedPnl),
      unit: quoteAsset,
      detail: "Reported account total",
      tone:
        totals?.realizedPnl != null
          ? Number(totals.realizedPnl) < 0
            ? "negative"
            : Number(totals.realizedPnl) > 0
              ? "positive"
              : ""
          : ""
    },
    {
      label: "Open orders",
      value: account ? String(orders.length) : "--",
      unit: "",
      detail: "In the loaded account snapshot",
      tone: ""
    },
    {
      label: `Managed ${baseAsset}`,
      value: position?.quantity ?? "--",
      unit: baseAsset,
      detail: position?.quantity != null ? "Strategy-managed position" : "Position not reported",
      tone: ""
    }
  ];
  return (
    <div className="ov-layout" ref={entranceRef}>
      <header className="ov-heading">
        <div>
          <div className="ov-title-line">
            <h1>Overview</h1>
            <span className="ov-environment">Testnet account</span>
          </div>
          <p>Your market, account and execution at a glance.</p>
        </div>
        <div className="ov-heading-actions">
          <span className="ov-sync">
            <span
              className={`ov-dot ov-dot-${accountFresh ? "good" : "warning"}`}
              aria-hidden="true"
            />
            {accountFresh
              ? `Account updated ${age(transport.account.lastReceivedAt, now)} ago`
              : "Account data stale"}
          </span>
          <a className="ov-button" href="#/market">
            Open market
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
      </header>

      <section className="ov-metrics" aria-label="Account summary">
        {metrics.map((metric) => (
          <div className="ov-metric" key={metric.label}>
            <span className="ov-metric-label">{metric.label}</span>
            <div
              className={`ov-metric-value ${metric.tone} ${metric.value === "--" ? "ov-unavailable" : ""}`}
            >
              {metric.value}
              <span>{metric.unit}</span>
            </div>
            <p>{metric.detail}</p>
          </div>
        ))}
      </section>

      <div className="ov-content">
        <div className="ov-primary">
          <section className="ov-panel ov-market" aria-labelledby="ov-market-title">
            <div className="ov-panel-heading">
              <h2 id="ov-market-title">Market overview</h2>
              <span className="ov-live">
                <span
                  className={`ov-dot ov-dot-${marketFresh ? "good" : "warning"}`}
                  aria-hidden="true"
                />
                {marketFresh ? "Live market data" : "Market data stale"}
              </span>
            </div>
            <div className="ov-market-heading">
              <div>
                <div className="ov-instrument">
                  <span className="ov-asset" aria-hidden="true">
                    {baseAsset.slice(0, 1)}
                  </span>
                  <strong>
                    {baseAsset}
                    <span> / {quoteAsset}</span>
                  </strong>
                  <span className="ov-venue">Binance Spot</span>
                </div>
                <div className="ov-market-price">
                  {formatUsd(currentPrice)}
                  <span
                    className={
                      candleChange !== null && candleChange < 0
                        ? "negative"
                        : candleChange !== null
                          ? "positive"
                          : "muted"
                    }
                  >
                    {formatSignedPercent(candleChange)}
                    <small>{timeframe} candle</small>
                  </span>
                </div>
              </div>
              <CandleInterval
                timeframe={timeframe}
                onTimeframe={onTimeframe}
                label="Overview candle interval"
              />
            </div>
            <div className="ov-chart">
              <MarketChart
                appearance="overview"
                candles={market.candles}
                baseAsset={baseAsset}
                fills={(account?.fills ?? []).filter((fill) => fill.symbol === symbol)}
              />
            </div>
          </section>

          <section className="ov-panel ov-fills" aria-labelledby="ov-fills-title">
            <div className="ov-panel-heading">
              <h2 id="ov-fills-title">
                Recent fills
                <span className="ov-count">{account ? account.fills.length : "--"}</span>
              </h2>
              <a className="ov-text-link" href="#/trading">
                View trading
                <ArrowUpRight size={13} aria-hidden="true" />
              </a>
            </div>
            {fills.length ? (
              <div className="ov-table-scroll">
                <table className="ov-table">
                  <thead>
                    <tr>
                      <th scope="col">Instrument</th>
                      <th scope="col">Side</th>
                      <th scope="col">Quantity</th>
                      <th scope="col">Price</th>
                      <th scope="col">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fills.map((fill) => (
                      <tr key={`${fill.clientOrderId}:${fill.executionId}`}>
                        <th scope="row">{fill.symbol}</th>
                        <td>
                          <span className={fill.side === "BUY" ? "positive" : "negative"}>
                            {fill.side === "BUY" ? "Buy" : "Sell"}
                          </span>
                        </td>
                        <td>{fill.quantity}</td>
                        <td>{formatUsd(fill.price)}</td>
                        <td>{formatTime(fill.eventTimeMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="ov-empty ov-empty-inline">
                <span className="ov-empty-icon">
                  <Layers3 size={19} strokeWidth={1.5} aria-hidden="true" />
                </span>
                <div>
                  <h3>No fills yet</h3>
                  <p>Completed executions will appear here.</p>
                </div>
              </div>
            )}
          </section>
        </div>

        <aside className="ov-sidebar" aria-label="Account operations">
          <section className="ov-panel ov-execution" aria-labelledby="ov-execution-title">
            <div className="ov-panel-heading">
              <h2 id="ov-execution-title">Execution status</h2>
              {control?.engaged ? (
                <ShieldCheck size={17} aria-hidden="true" />
              ) : (
                <ShieldOff size={17} aria-hidden="true" />
              )}
            </div>
            <div className={`ov-execution-state ${control?.engaged ? "ov-blocked" : ""}`}>
              <span
                className={`ov-dot ov-dot-${control ? "warning" : "muted"}`}
                aria-hidden="true"
              />
              {control
                ? control.engaged
                  ? "Execution blocked"
                  : "Kill switch disengaged"
                : "State not available"}
            </div>
            <p>
              {control?.reason === "awaiting-explicit-activation"
                ? "Execution is waiting for explicit activation."
                : control?.reason || "Waiting for a reported risk state."}
            </p>
            <a className="ov-text-link" href="#/risk">
              Review risk controls
              <ArrowRight size={13} aria-hidden="true" />
            </a>
          </section>

          <section className="ov-panel ov-strategies" aria-labelledby="ov-strategies-title">
            <div className="ov-panel-heading">
              <h2 id="ov-strategies-title">
                Strategies
                <span className="ov-count">{account ? account.strategies.length : "--"}</span>
              </h2>
              <a className="ov-icon-link" href="#/strategies" aria-label="View strategies">
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            </div>
            {account?.strategies.length ? (
              <ul className="ov-strategy-list">
                {account.strategies.map((strategy) => (
                  <li key={strategy.strategyId}>
                    <div>
                      <strong>{strategy.strategyId}</strong>
                      <span>{strategy.reason || "No status detail reported"}</span>
                    </div>
                    <span className="ov-strategy-state">
                      {strategy.paused ? "Paused" : "Not paused"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="ov-empty ov-strategy-empty">
                <Layers3 size={22} strokeWidth={1.5} aria-hidden="true" />
                <h3>No strategies reported</h3>
                <p>Strategy state will appear when it is reported by the account.</p>
                <a className="ov-text-link" href="#/strategies">
                  View strategies
                  <ArrowRight size={13} aria-hidden="true" />
                </a>
              </div>
            )}
          </section>

          <section className="ov-panel ov-connections" aria-labelledby="ov-connections-title">
            <div className="ov-panel-heading">
              <h2 id="ov-connections-title">Connections</h2>
              <a className="ov-icon-link" href="#/system" aria-label="View system status">
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            </div>
            <dl>
              <ConnectionState
                label="API"
                value={accountFresh ? "Responding" : "Unknown"}
                tone={accountFresh ? "good" : "warning"}
              />
              <ConnectionState
                label="Market feed"
                value={marketFresh ? "Live" : "Stale"}
                tone={marketFresh ? "good" : "warning"}
              />
              <ConnectionState
                label="Redis"
                value={
                  healthFresh
                    ? health!.redis === "available"
                      ? "Available"
                      : "Unavailable"
                    : "Unknown"
                }
                tone={healthFresh && health!.redis === "available" ? "good" : "warning"}
              />
              <ConnectionState
                label="TimescaleDB"
                value={
                  healthFresh
                    ? health!.database === "available"
                      ? "Available"
                      : "Unavailable"
                    : "Unknown"
                }
                tone={healthFresh && health!.database === "available" ? "good" : "warning"}
              />
              <ConnectionState label="Engine" value="Not reported" tone="muted" />
              <ConnectionState label="Executor" value="Not reported" tone="muted" />
            </dl>
          </section>
        </aside>
      </div>

      <section className="ov-panel ov-activity" aria-labelledby="ov-activity-title">
        <div className="ov-panel-heading">
          <h2 id="ov-activity-title">Trading &amp; risk activity</h2>
          <span className="ov-secondary">Latest account events</span>
        </div>
        {events.length ? (
          <ol className="ov-timeline">
            {events.map((event) => (
              <li key={event.id}>
                <span className={`ov-event-kind ${event.kind === "Risk" ? "ov-event-risk" : ""}`}>
                  {event.kind}
                </span>
                <div>
                  <strong>{event.title}</strong>
                  <p>{event.detail}</p>
                </div>
                <time dateTime={new Date(event.time).toISOString()}>{formatTime(event.time)}</time>
              </li>
            ))}
          </ol>
        ) : (
          <div className="ov-empty ov-empty-inline">
            <span className="ov-empty-icon">
              <Activity size={19} strokeWidth={1.5} aria-hidden="true" />
            </span>
            <div>
              <h3>No trading activity yet</h3>
              <p>Order, fill and risk events will appear here as they are reported.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
