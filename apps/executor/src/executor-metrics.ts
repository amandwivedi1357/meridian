import { Counter, type Registry } from "@meridian/observability";
import type { Signal } from "@meridian/core";

export interface ExecutorMetricsDeps {
  readonly registry: Registry;
}

export interface ExecutorMetrics {
  readonly recordExpiredSignal: (signal: Signal) => void;
}

export function registerExecutorMetrics(deps: ExecutorMetricsDeps): ExecutorMetrics {
  const expiredSignals = new Counter({
    name: "signals_expired_total",
    help: "Total trading signals dropped by the executor because validUntilMs was in the past.",
    labelNames: ["strategyId", "symbol"],
    registers: [deps.registry]
  });

  return {
    recordExpiredSignal(signal) {
      expiredSignals.inc({
        strategyId: signal.strategyId,
        symbol: signal.intent.symbol
      });
    }
  };
}
