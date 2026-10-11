import { Pause, Play } from "lucide-react";
import type { ReactNode } from "react";
import type { StrategyControlState } from "../../lib/api-client.js";
import { StatusBadge } from "./StatusBadge.js";

export function Sidebar({
  strategies,
  operator,
  onRequestPause,
  onRequestResume,
  children
}: {
  strategies: readonly StrategyControlState[];
  operator: boolean;
  onRequestPause: (id: string) => void;
  onRequestResume: (id: string) => void;
  children?: ReactNode;
}) {
  return (
    <aside className="terminal-sidebar">
      <section className="strategy-rail">
        <div className="panel-title">
          <span>Strategy controls</span>
        </div>
        {!strategies.length && <div className="terminal-empty compact">No strategy state</div>}
        {strategies.map((s) => (
          <article key={s.strategyId} className="strategy-card">
            <div className="strategy-card-head">
              <strong>{s.strategyId}</strong>
              <StatusBadge tone={s.paused ? "muted" : "green"}>
                {s.paused ? "Paused" : "Enabled"}
              </StatusBadge>
            </div>
            <p className="strategy-meta">{s.reason}</p>
            <button
              className="terminal-button terminal-button-ghost"
              disabled={!operator}
              onClick={() =>
                s.paused ? onRequestResume(s.strategyId) : onRequestPause(s.strategyId)
              }
            >
              {s.paused ? <Play size={12} /> : <Pause size={12} />} {s.paused ? "Resume" : "Pause"}
            </button>
          </article>
        ))}
      </section>
      {children}
    </aside>
  );
}
