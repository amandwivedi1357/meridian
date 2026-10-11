import { runDashboardFeed } from "../runtime/dashboard-feed.js";

const durationMs = Number(process.env.DASHBOARD_FEED_DURATION_MS ?? 3600000);
if (!Number.isSafeInteger(durationMs) || durationMs < 1000 || durationMs > 3600000)
  throw new Error("dashboard_feed_duration_must_be_1s_to_1h");
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
try {
  await runDashboardFeed({ signal: controller.signal, durationMs });
} catch {
  console.error("dashboard_feed_failed");
  process.exitCode = 1;
}
