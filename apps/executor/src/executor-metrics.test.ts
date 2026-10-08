import { Registry } from "@meridian/observability";
import { Decimal, type Signal } from "@meridian/core";
import { describe, expect, it } from "vitest";

import { registerExecutorMetrics } from "./executor-metrics.js";

function signal(): Signal {
  return {
    signalId: "sig_expired",
    strategyId: "ema",
    createdAtMs: 1_000,
    validUntilMs: 2_000,
    intent: {
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: new Decimal("0.0002"),
      reason: "stale crossover"
    }
  };
}

describe("registerExecutorMetrics", () => {
  it("exposes expired signal drops as a Prometheus counter", async () => {
    const registry = new Registry();
    const metrics = registerExecutorMetrics({ registry });

    metrics.recordExpiredSignal(signal());
    metrics.recordExpiredSignal(signal());

    const output = await registry.metrics();

    expect(output).toContain("# HELP signals_expired_total");
    expect(output).toContain(
      'signals_expired_total{strategyId="ema",symbol="BTCUSDT"} 2'
    );
  });
});
