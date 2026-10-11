import { Gauge, type Registry } from "@meridian/observability";
import type { Decimal } from "@meridian/core";

export function createRiskMetrics(
  registry: Registry,
  quoteAsset: string,
  scope: "allocated-testnet" | "full-wallet"
) {
  const options = { labelNames: ["quote_asset", "scope"] as const, registers: [registry] };
  const drawdown = new Gauge({
    ...options,
    name: "drawdown_pct",
    help: "Validated executor risk-snapshot drawdown as percent (0-100)"
  });
  const limit = new Gauge({
    ...options,
    name: "meridian_drawdown_limit_pct",
    help: "Effective executor drawdown breaker limit as percent"
  });
  const dailyPnl = new Gauge({
    ...options,
    name: "meridian_risk_daily_realized_pnl",
    help: "UTC-day realized PnL used by executor risk evaluation, not all-time portfolio PnL"
  });
  const equity = new Gauge({
    ...options,
    name: "meridian_risk_equity",
    help: "Validated equity in the effective executor risk scope"
  });
  const timestamp = new Gauge({
    ...options,
    name: "meridian_risk_sample_timestamp_seconds",
    help: "Underlying validated risk snapshot timestamp"
  });
  const all = [drawdown, limit, dailyPnl, equity, timestamp];
  const labels = { quote_asset: quoteAsset, scope };
  function clear() {
    for (const metric of all) metric.reset();
  }
  return {
    clear,
    record(sample: {
      drawdown: Decimal;
      limit: Decimal;
      dailyPnl: Decimal;
      equity: Decimal;
      observedAtMs: number;
    }) {
      clear();
      const values = [
        sample.drawdown.mul(100).toNumber(),
        sample.limit.mul(100).toNumber(),
        sample.dailyPnl.toNumber(),
        sample.equity.toNumber(),
        sample.observedAtMs / 1000
      ];
      if (!values.every(Number.isFinite)) return;
      all.forEach((metric, i) => metric.set(labels, values[i]!));
    }
  };
}
