import { Pause, Play } from "lucide-react";
import type { StrategyControlState } from "../../lib/api-client.js";
import { StatusBadge } from "./StatusBadge.js";

const fallbackStrategies = [
  { strategyId: "ema-live", paused: false, reason: "running", updatedAtMs: Date.now() },
  { strategyId: "trend-follower-v2", paused: false, reason: "running", updatedAtMs: Date.now() },
  { strategyId: "mean-revert", paused: true, reason: "risk review", updatedAtMs: Date.now() },
  { strategyId: "arbitrage-spike", paused: false, reason: "running", updatedAtMs: Date.now() }
] satisfies StrategyControlState[];

export function Sidebar({
  strategies,
  selectedStrategyId,
  onSelectStrategy,
  onRequestPause,
  onRequestResume
}: {
  readonly strategies: readonly StrategyControlState[];
  readonly selectedStrategyId: string;
  readonly onSelectStrategy: (strategyId: string) => void;
  readonly onRequestPause: (strategyId: string) => void;
  readonly onRequestResume: (strategyId: string) => void;
}) {
  const visibleStrategies = strategies.length > 0 ? strategies : fallbackStrategies;

  return (
    <aside className="terminal-sidebar">
      <div className="icon-rail" aria-hidden="true">
        <span className="rail-logo">M</span>
        <span className="rail-icon active" />
        <span className="rail-icon" />
        <span className="rail-icon" />
      </div>
      <section className="rail-panel allocation-panel">
        <div className="panel-title">
          <span>Asset allocation</span>
          <small>By balance</small>
        </div>
        <AllocationRow asset="USDT" value="58%" tone="green" />
        <AllocationRow asset="BTC" value="29%" tone="blue" />
        <AllocationRow asset="Free" value="13%" tone="amber" />
      </section>
      <section className="strategy-rail">
        <div className="panel-title">
          <span>Active strategies</span>
          <button aria-label="Add strategy">+</button>
        </div>
        {visibleStrategies.map((strategy, index) => (
          <button
            key={strategy.strategyId}
            className={
              strategy.strategyId === selectedStrategyId ? "strategy-card selected" : "strategy-card"
            }
            onClick={() => onSelectStrategy(strategy.strategyId)}
          >
            <div className="strategy-card-head">
              <span className={`strategy-avatar strategy-avatar-${index % 4}`} />
              <strong>{labelForStrategy(strategy.strategyId)}</strong>
              <StatusBadge tone={strategy.paused ? "muted" : "green"}>
                {strategy.paused ? "Paused" : "Running"}
              </StatusBadge>
            </div>
            <span className="strategy-meta">BTCUSDT · {index % 2 === 0 ? "15m" : "1h"}</span>
            <div className="strategy-stats">
              <span>
                Trades <b>{142 - index * 18}</b>
              </span>
              <span>
                Win rate <b>{(68.4 - index * 3.2).toFixed(1)}%</b>
              </span>
              <span>
                PnL (24h) <b className={index === 2 ? "negative" : "positive"}>{index === 2 ? "-$18.40" : "+$128.41"}</b>
              </span>
            </div>
            <div className="strategy-action">
              <small>Risk {index === 2 ? "High" : "Low"}</small>
              {strategy.paused ? (
                <span onClick={(event) => { event.stopPropagation(); onRequestResume(strategy.strategyId); }}>
                  <Play size={11} /> Resume
                </span>
              ) : (
                <span className="danger" onClick={(event) => { event.stopPropagation(); onRequestPause(strategy.strategyId); }}>
                  <Pause size={11} /> Pause
                </span>
              )}
            </div>
          </button>
        ))}
      </section>
    </aside>
  );
}

function AllocationRow({
  asset,
  value,
  tone
}: {
  readonly asset: string;
  readonly value: string;
  readonly tone: "green" | "blue" | "amber";
}) {
  return (
    <div className="allocation-row">
      <span>{asset}</span>
      <div>
        <i className={`allocation-fill allocation-${tone}`} style={{ width: value }} />
      </div>
      <b>{value}</b>
    </div>
  );
}

function labelForStrategy(strategyId: string): string {
  const labels: Record<string, string> = {
    "ema-live": "EMA Scalper Pro",
    "trend-follower-v2": "Trend Follower v2",
    "mean-revert": "Mean Revert",
    "arbitrage-spike": "Arbitrage Spike"
  };
  if (labels[strategyId] !== undefined) return labels[strategyId];

  return strategyId
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
