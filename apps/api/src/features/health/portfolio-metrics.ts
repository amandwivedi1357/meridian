import { Gauge, type Registry } from "@meridian/observability";
import type { PortfolioReader } from "../account/portfolio.js";

export function instrumentPortfolio(read: PortfolioReader, registry: Registry): PortfolioReader {
  const options = {
    labelNames: ["quote_asset", "environment", "scope"] as const,
    registers: [registry]
  };
  const realized = new Gauge({
    ...options,
    name: "pnl_realized",
    help: "All-time weighted-average persisted-fill realized PnL; not exchange wallet performance"
  });
  const unrealized = new Gauge({
    ...options,
    name: "pnl_unrealized",
    help: "Persisted-fill marked unrealized PnL; unknown values are absent"
  });
  const timestamp = new Gauge({
    name: "meridian_portfolio_sample_timestamp_seconds",
    help: "Accounting sample timestamp; refreshed by existing portfolio reads",
    labelNames: ["scope"],
    registers: [registry]
  });
  function clear() {
    realized.reset();
    unrealized.reset();
    timestamp.reset();
  }
  return async () => {
    try {
      const sample = await read();
      clear();
      // Late responses cannot turn stale financial values into fresh observations.
      if (Date.now() - sample.checkedAt > 15000 || sample.checkedAt > Date.now() + 5000)
        return sample;
      timestamp.set({ scope: sample.scope }, sample.checkedAt / 1000);
      for (const total of sample.totals) {
        if (!/^[A-Z0-9]{1,20}$/.test(total.quoteAsset)) continue;
        const labels = {
          quote_asset: total.quoteAsset,
          environment: sample.environment,
          scope: sample.scope
        };
        for (const [metric, value] of [
          [realized, total.realizedPnl],
          [unrealized, total.unrealizedPnl]
        ] as const) {
          if (value === null || !/^-?\d+(\.\d+)?$/.test(value)) continue;
          const numeric = Number(value);
          if (Number.isFinite(numeric)) metric.set(labels, numeric);
        }
      }
      return sample;
    } catch (error) {
      clear();
      throw error;
    }
  };
}
