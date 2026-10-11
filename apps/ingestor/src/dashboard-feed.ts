import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { runDashboardFeed } from "./runtime/dashboard-feed.js";
import {
  createServiceDiagnostics,
  createShutdownGuard,
  createMetricsRegistry,
  diagnosticsAddress
} from "@meridian/observability";

const controller = new AbortController();
const registry = createMetricsRegistry("ingestor");
let feedReady = false;
const diagnostics = createServiceDiagnostics({
  service: "ingestor",
  registry,
  checkReady: () => feedReady && !controller.signal.aborted
});
controller.signal.addEventListener("abort", () => diagnostics.stopping(), { once: true });
const shutdown = createShutdownGuard({ onStop: () => controller.abort() });
mkdirSync("logs/dev", { recursive: true });
const path = "logs/dev/dashboard-feed.log";
function log(event: Record<string, unknown>) {
  if (existsSync(path) && statSync(path).size >= 5 * 1024 * 1024) {
    rmSync(`${path}.1`, { force: true });
    renameSync(path, `${path}.1`);
  }
  appendFileSync(path, `${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`);
}
let attempt = 0;
try {
  await diagnostics.listen(diagnosticsAddress("ingestor"));
  diagnostics.started();
  while (!controller.signal.aborted) {
    const started = Date.now();
    try {
      await runDashboardFeed({
        signal: controller.signal,
        log,
        metricsRegistry: registry,
        onReady: (ready) => {
          feedReady = ready;
        }
      });
    } catch (error) {
      const reason =
        error instanceof Error && /^dashboard_feed_[a-z_]+$/.test(error.message)
          ? error.message
          : "dashboard_feed_dependency_failed";
      log({ kind: "public_dashboard_feed_retry", reason });
    }
    if (controller.signal.aborted) break;
    attempt = Date.now() - started > 60000 ? 0 : Math.min(attempt + 1, 4);
    await delay(Math.min(60000, 5000 * 2 ** attempt), undefined, {
      signal: controller.signal
    }).catch(() => undefined);
  }
} finally {
  await diagnostics.close();
  shutdown.finish();
}
