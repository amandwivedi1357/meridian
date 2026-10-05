import { useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  BarChart3,
  CandlestickChart,
  FileText,
  GitCompareArrows,
  LineChart,
  ListChecks,
  TrendingDown,
  TrendingUp
} from "lucide-react";
import { mockBacktestRuns, type BacktestPoint } from "./mock-backtest-data.js";

const money = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export function BacktestPreview() {
  const [selectedId, setSelectedId] = useState(mockBacktestRuns[0]?.id ?? "");
  const selected = mockBacktestRuns.find((run) => run.id === selectedId) ?? mockBacktestRuns[0];
  if (!selected) return null;
  const spread = selected.metrics.totalReturnPct - selected.metrics.buyAndHoldReturnPct;
  const equityChange = selected.equity.at(-1)?.equity ?? 0;

  return (
    <div className="lab-shell">
      <section className="lab-hero">
        <div>
          <div className="eyebrow">BACKTESTS / STRATEGY LAB</div>
          <h1>Backtest control surface</h1>
          <p>
            Saved-run preview for Phase 2.4: persistence, reports, benchmark comparison, and
            walk-forward work in one place.
          </p>
        </div>
        <div className="lab-hero-stats" aria-label="Backtest preview status">
          <span>
            <ListChecks size={15} />
            {mockBacktestRuns.length} saved runs
          </span>
          <span>
            <FileText size={15} />
            HTML reports ready
          </span>
        </div>
      </section>

      <div className="lab-grid">
        <aside className="run-list" aria-label="Saved backtest runs">
          <div className="section-heading">
            <h2>Saved runs</h2>
            <span className="muted">Mock data</span>
          </div>
          {mockBacktestRuns.map((run) => (
            <button
              className={run.id === selected.id ? "run-card active" : "run-card"}
              key={run.id}
              onClick={() => setSelectedId(run.id)}
            >
              <span className="run-card-top">
                <b>{run.label}</b>
                <small>{run.status}</small>
              </span>
              <span>
                {run.strategy} · {run.interval}
              </span>
              <span className="run-card-bottom">
                <small>{run.range}</small>
                <strong className={run.metrics.totalReturnPct >= 0 ? "buy" : "sell"}>
                  {formatSigned(run.metrics.totalReturnPct)}%
                </strong>
              </span>
            </button>
          ))}
        </aside>

        <section className="run-summary" aria-label="Selected backtest summary">
          <div className="summary-head">
            <div>
              <div className="eyebrow">SELECTED RUN</div>
              <h2>{selected.label}</h2>
              <p>
                {selected.strategy} · {selected.symbol} · {selected.interval} · {selected.range}
              </p>
            </div>
            <span className="lab-status">
              <Activity size={14} />
              saved report
            </span>
          </div>

          <div className="lab-metrics">
            <LabMetric
              label="Total return"
              value={`${formatSigned(selected.metrics.totalReturnPct)}%`}
              tone={selected.metrics.totalReturnPct >= 0 ? "good" : "bad"}
              icon={<TrendingUp size={16} />}
            />
            <LabMetric
              label="Max drawdown"
              value={`${percent.format(selected.metrics.maxDrawdownPct)}%`}
              tone="bad"
              icon={<TrendingDown size={16} />}
            />
            <LabMetric
              label="Trades"
              value={String(selected.metrics.tradeCount)}
              tone="neutral"
              icon={<CandlestickChart size={16} />}
            />
            <LabMetric
              label="Win rate"
              value={`${percent.format(selected.metrics.winRatePct)}%`}
              tone="neutral"
              icon={<BarChart3 size={16} />}
            />
          </div>

          <div className="benchmark-strip">
            <div>
              <span>Strategy</span>
              <strong className={selected.metrics.totalReturnPct >= 0 ? "buy" : "sell"}>
                {formatSigned(selected.metrics.totalReturnPct)}%
              </strong>
            </div>
            <GitCompareArrows size={18} />
            <div>
              <span>Buy & hold</span>
              <strong className={selected.metrics.buyAndHoldReturnPct >= 0 ? "buy" : "sell"}>
                {formatSigned(selected.metrics.buyAndHoldReturnPct)}%
              </strong>
            </div>
            <div>
              <span>Delta</span>
              <strong className={spread >= 0 ? "buy" : "sell"}>{formatSigned(spread)}%</strong>
            </div>
          </div>

          <div className="chart-pair">
            <PreviewChart
              title="Equity curve"
              icon={<LineChart size={15} />}
              points={selected.equity}
              getValue={(point) => point.equity}
              tone="equity"
              footer={`Ending equity ${money.format(equityChange)} USDT`}
            />
            <PreviewChart
              title="Drawdown"
              icon={<TrendingDown size={15} />}
              points={selected.equity}
              getValue={(point) => point.drawdown}
              tone="drawdown"
              footer={`Worst sample ${percent.format(selected.metrics.maxDrawdownPct)}%`}
            />
          </div>

          <section className="fills-panel">
            <div className="section-heading">
              <h2>Recent fills</h2>
              <span className="muted">{selected.fills.length} shown</span>
            </div>
            <div className="table-scroll lab-table">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Side</th>
                    <th>Price</th>
                    <th>Quantity</th>
                    <th>Fee</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.fills.map((fill) => (
                    <tr key={fill.id}>
                      <td>{fill.time}</td>
                      <td className={fill.side === "BUY" ? "buy" : "sell"}>{fill.side}</td>
                      <td>{money.format(fill.price)}</td>
                      <td>{fill.quantity}</td>
                      <td>{fill.fee}</td>
                      <td className="fill-reason">{fill.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </div>
    </div>
  );
}

function LabMetric({
  label,
  value,
  tone,
  icon
}: {
  label: string;
  value: string;
  tone: "good" | "bad" | "neutral";
  icon: ReactNode;
}) {
  return (
    <div className={`lab-metric ${tone}`}>
      <span>
        {label}
        {icon}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function PreviewChart({
  title,
  icon,
  points,
  getValue,
  tone,
  footer
}: {
  title: string;
  icon: ReactNode;
  points: readonly BacktestPoint[];
  getValue: (point: BacktestPoint) => number;
  tone: "equity" | "drawdown";
  footer: string;
}) {
  const path = useMemo(() => buildPath(points.map(getValue)), [getValue, points]);
  const labels = points.map((point) => point.t);

  return (
    <section className="preview-chart">
      <div className="section-heading">
        <h2>
          {icon}
          {title}
        </h2>
        <span className="muted">{labels[0]} / {labels.at(-1)}</span>
      </div>
      <svg viewBox="0 0 640 210" role="img" aria-label={`${title} chart`}>
        <defs>
          <linearGradient id={`fill-${tone}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={tone === "equity" ? "#38b981" : "#e2785e"} stopOpacity="0.24" />
            <stop offset="100%" stopColor={tone === "equity" ? "#38b981" : "#e2785e"} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="chart-gridline" d="M 18 42 H 620 M 18 105 H 620 M 18 168 H 620" />
        <path className={`chart-area ${tone}`} d={`${path.area} L 622 186 L 18 186 Z`} />
        <path className={`chart-line ${tone}`} d={path.line} />
      </svg>
      <div className="chart-caption">{footer}</div>
    </section>
  );
}

function buildPath(values: readonly number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 604;
  const height = 152;
  const points = values.map((value, index) => {
    const x = 18 + (index / Math.max(values.length - 1, 1)) * width;
    const y = 34 + (1 - normalize(value, min, max)) * height;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  return { line: points.join(" "), area: points.join(" ") };
}

function normalize(value: number, min: number, max: number) {
  if (min === max) return 0.5;
  return (value - min) / (max - min);
}

function formatSigned(value: number) {
  return `${value >= 0 ? "+" : ""}${percent.format(value)}`;
}
