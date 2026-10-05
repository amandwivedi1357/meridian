import type { SavedBacktestRunReport } from "../results/backtest-result-reader.js";

interface ChartPoint {
  readonly x: number;
  readonly y: number;
}

export function renderBacktestHtmlReport(report: SavedBacktestRunReport): string {
  const equityPoints = report.equityCurve.map((point) => ({
    tsMs: point.tsMs,
    value: Number(point.equity)
  }));
  const drawdownPoints = calculateDrawdownPoints(equityPoints);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(report.runId)} backtest report</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #10231d;
      background: #f4f7f5;
    }
    body { margin: 0; background: #f4f7f5; }
    main { max-width: 1180px; margin: 0 auto; padding: 32px 24px 48px; }
    header { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 28px; }
    h1 { margin: 0; font-size: 30px; line-height: 1.1; }
    h2 { margin: 0 0 14px; font-size: 18px; }
    .muted { color: #5f716b; }
    .run-id { margin-top: 8px; font-family: "SFMono-Regular", Consolas, monospace; font-size: 13px; color: #416157; }
    .badge { border: 1px solid #cbd8d2; border-radius: 999px; padding: 6px 10px; background: #ffffff; font-size: 12px; color: #416157; white-space: nowrap; }
    .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
    .metric, section { background: #ffffff; border: 1px solid #dce5e0; border-radius: 8px; }
    .metric { padding: 16px; }
    .metric .label { font-size: 12px; color: #6b7b76; margin-bottom: 8px; }
    .metric .value { font-size: 24px; font-weight: 700; }
    .grid { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; margin-bottom: 16px; }
    section { padding: 18px; margin-bottom: 16px; }
    svg { width: 100%; height: auto; display: block; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid #e7eeeb; padding: 10px 8px; text-align: left; }
    th { color: #52665f; font-weight: 600; background: #f8faf9; }
    .kv { display: grid; grid-template-columns: 130px 1fr; gap: 8px 12px; font-size: 13px; }
    .kv div:nth-child(odd) { color: #60746d; }
    .empty { color: #6b7b76; font-size: 13px; padding: 10px 0; }
    @media (max-width: 860px) {
      header, .grid { display: block; }
      .badge { display: inline-block; margin-top: 12px; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <div class="muted">${escapeHtml(report.strategy)} / ${escapeHtml(report.symbol)} / ${escapeHtml(report.interval)}</div>
        <h1>Backtest report</h1>
        <div class="run-id">${escapeHtml(report.runId)}</div>
      </div>
      <div class="badge">Created ${escapeHtml(report.createdAt)}</div>
    </header>

    <div class="metrics">
      ${metricCard("Total return", metric(report, "totalReturnPct"), "%")}
      ${metricCard("Buy & hold", metric(report, "buyAndHoldReturnPct"), "%")}
      ${metricCard("Max drawdown", metric(report, "maxDrawdownPct"), "%")}
      ${metricCard("Trades", metric(report, "tradeCount"), "")}
      ${metricCard("CAGR", metric(report, "cagrPct"), "%")}
      ${metricCard("Sharpe", metric(report, "sharpeRatio"), "")}
      ${metricCard("Win rate", metric(report, "winRatePct"), "%")}
      ${metricCard("Exposure", metric(report, "exposurePct"), "%")}
    </div>

    <div class="grid">
      <section>
        <h2>Equity curve</h2>
        ${lineChart(equityPoints.map((point) => ({ x: point.tsMs, y: point.value })), "#0c8a61", "equity")}
      </section>
      <section>
        <h2>Run details</h2>
        <div class="kv">
          <div>From</div><div>${escapeHtml(new Date(report.fromMs).toISOString())}</div>
          <div>To</div><div>${escapeHtml(new Date(report.toMs).toISOString())}</div>
          <div>Fills</div><div>${report.fills.length}</div>
          <div>Equity points</div><div>${report.equityCurve.length}</div>
        </div>
      </section>
    </div>

    <section>
      <h2>Drawdown</h2>
      ${lineChart(drawdownPoints, "#c2410c", "drawdown")}
    </section>

    <section>
      <h2>Parameters</h2>
      ${objectTable(report.params)}
    </section>

    <section>
      <h2>Fills</h2>
      ${fillsTable(report)}
    </section>
  </main>
</body>
</html>`;
}

function metricCard(label: string, value: string, suffix: string): string {
  return `<div class="metric"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}${suffix}</div></div>`;
}

function metric(report: SavedBacktestRunReport, key: string): string {
  const value = report.metrics[key];
  return value === undefined ? "n/a" : String(value);
}

function objectTable(value: Record<string, unknown>): string {
  const entries = Object.entries(value);
  if (entries.length === 0) return `<div class="empty">No parameters stored.</div>`;

  return `<table><tbody>${entries
    .map(
      ([key, entry]) =>
        `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(formatUnknown(entry))}</td></tr>`
    )
    .join("")}</tbody></table>`;
}

function fillsTable(report: SavedBacktestRunReport): string {
  if (report.fills.length === 0) return `<div class="empty">No fills recorded.</div>`;

  return `<table>
    <thead><tr><th>Time</th><th>Side</th><th>Quantity</th><th>Price</th><th>Fee</th></tr></thead>
    <tbody>${report.fills
      .map(
        (fill) =>
          `<tr><td>${escapeHtml(new Date(fill.tsMs).toISOString())}</td><td>${escapeHtml(fill.side)}</td><td>${escapeHtml(fill.quantity)}</td><td>${escapeHtml(fill.price)}</td><td>${escapeHtml(fill.fee)} ${escapeHtml(fill.feeAsset)}</td></tr>`
      )
      .join("")}</tbody>
  </table>`;
}

function lineChart(points: readonly ChartPoint[], color: string, label: string): string {
  if (points.length === 0) return `<div class="empty">No ${escapeHtml(label)} points recorded.</div>`;

  const width = 760;
  const height = 260;
  const padding = 24;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const path = points
    .map((point, index) => {
      const x = scale(point.x, minX, maxX, padding, width - padding);
      const y = scale(point.y, minY, maxY, height - padding, padding);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)} chart">
    <rect x="0" y="0" width="${width}" height="${height}" fill="#fbfdfc" />
    <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#dce5e0" />
    <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="#dce5e0" />
    <path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    <text x="${padding}" y="18" fill="#60746d" font-size="12">${escapeHtml(maxY.toFixed(4))}</text>
    <text x="${padding}" y="${height - 6}" fill="#60746d" font-size="12">${escapeHtml(minY.toFixed(4))}</text>
  </svg>`;
}

function calculateDrawdownPoints(points: readonly { readonly tsMs: number; readonly value: number }[]): ChartPoint[] {
  let peak = Number.NEGATIVE_INFINITY;
  return points.map((point) => {
    peak = Math.max(peak, point.value);
    const drawdown = peak <= 0 ? 0 : ((point.value - peak) / peak) * 100;
    return { x: point.tsMs, y: drawdown };
  });
}

function scale(value: number, min: number, max: number, outputMin: number, outputMax: number): number {
  if (min === max) return (outputMin + outputMax) / 2;
  return outputMin + ((value - min) / (max - min)) * (outputMax - outputMin);
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
