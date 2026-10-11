import { Counter, Gauge, Histogram, type Registry } from "@meridian/observability";

export function createWorkerMetrics(registry: Registry) {
  const ready = new Gauge({
    name: "meridian_backtest_dispatcher_ready",
    help: "Dispatcher has a recent successful queue/lease tick",
    registers: [registry]
  });
  const active = new Gauge({
    name: "meridian_backtest_active_children",
    help: "Locally running simulation child processes, not queue length",
    registers: [registry]
  });
  const ticks = new Counter({
    name: "meridian_backtest_dispatcher_ticks_total",
    help: "Queue/lease ticks by outcome",
    labelNames: ["outcome"],
    registers: [registry]
  });
  const exits = new Counter({
    name: "meridian_backtest_process_exits_total",
    help: "Worker process outcomes, not durable backtest job results",
    labelNames: ["outcome"],
    registers: [registry]
  });
  const duration = new Histogram({
    name: "meridian_backtest_process_duration_seconds",
    help: "Simulation child wall-clock lifetime",
    registers: [registry],
    buckets: [0.1, 0.5, 1, 5, 10, 30, 60]
  });
  ready.set(0);
  active.set(0);
  return {
    ready: (value: boolean) => ready.set(value ? 1 : 0),
    active: (value: 0 | 1) => active.set(value),
    tick: (ok: boolean) => ticks.inc({ outcome: ok ? "success" : "failure" }),
    exit: (
      outcome: "exit_zero" | "exit_nonzero" | "spawn_error" | "timeout" | "shutdown",
      seconds: number
    ) => {
      exits.inc({ outcome });
      duration.observe(seconds);
    }
  };
}
