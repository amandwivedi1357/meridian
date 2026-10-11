/* global __ENV, __VU */
import sse from "k6/x/sse";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";

const ready = new Counter("dashboard_sse_ready");
const completed = new Counter("dashboard_sse_completed");
const errors = new Counter("dashboard_sse_errors");
const resyncs = new Counter("dashboard_sse_resyncs");
const events = new Counter("dashboard_sse_updates");
const heartbeats = new Counter("dashboard_sse_heartbeats");
const latency = new Trend("dashboard_market_delivery_ms", true);
const connectMs = new Trend("dashboard_connect_ms", true);
const vus = Number(__ENV.SSE_COHORT_VUS || 250);
export const options = {
  scenarios: {
    first: { executor: "per-vu-iterations", vus, iterations: 1, maxDuration: "4m" },
    second: {
      executor: "per-vu-iterations",
      vus,
      iterations: 1,
      startTime: "61s",
      maxDuration: "3m"
    }
  },
  thresholds: {
    checks: ["rate==1"],
    dashboard_sse_ready: [`count==${vus * 2}`],
    dashboard_sse_completed: [`count==${vus * 2}`],
    dashboard_sse_errors: ["count==0"],
    dashboard_sse_resyncs: ["count==0"],
    dashboard_market_delivery_ms: ["p(95)<1000"]
  }
};

export default function () {
  const kind = __VU % 2 ? "market" : "account";
  let opened = false,
    done = false,
    updates = 0,
    beats = 0;
  const started = Date.now();
  errors.add(0);
  resyncs.add(0);
  const response = sse.open(
    `${__ENV.SSE_BASE_URL}/api/stream/${kind}?symbol=BTCUSDT&interval=15m`,
    {
      headers: { Authorization: `Bearer ${__ENV.SSE_JWT}` },
      timeout: "4m",
      tags: { channel: kind }
    },
    (client) => {
      client.on("event", (event) => {
        if (event.name === "ready" && !opened) {
          opened = true;
          ready.add(1, { channel: kind });
          connectMs.add(Date.now() - started);
        }
        if (event.name === "heartbeat") {
          beats++;
          heartbeats.add(1, { channel: kind });
        }
        if (event.name === "resync") {
          resyncs.add(1);
          client.close();
        }
        if (event.name !== kind) return;
        const batch = JSON.parse(event.data).events;
        updates += batch.length;
        events.add(batch.length, { channel: kind });
        if (kind === "market") {
          const trades = batch.filter((value) => value.kind === "trade");
          const last = trades[trades.length - 1];
          if (last) latency.add(Date.now() - last.occurredAtMs);
          done = trades.some((value) => value.trade.tradeId === "999999999");
        } else done = batch.some((value) => value.riskControl?.reason === "load-complete");
        if (done) {
          completed.add(1, { channel: kind });
          client.close();
        }
      });
      client.on("error", () => {
        if (!done) errors.add(1);
      });
    }
  );
  check(response, { "authenticated SSE 200": (value) => value && value.status === 200 });
  check(
    { opened, done, updates, beats },
    {
      "received ready and completion": (value) => value.opened && value.done,
      "received sustained updates and heartbeats": (value) =>
        value.updates >= 20 && value.beats >= 3
    }
  );
}

export function handleSummary(data) {
  return { [__ENV.SSE_SUMMARY_PATH]: JSON.stringify(data, null, 2) };
}
