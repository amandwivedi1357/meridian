/* global __ENV */
import http from "k6/http";
import { check } from "k6";
import { Trend, Counter } from "k6/metrics";

const bus = new Trend("ingest_bus_ms", true);
const operation = new Trend("ingest_operation_ms", true);
const completed = new Counter("ingest_completed");
const refused = new Counter("ingest_capacity_refused");
const burst = __ENV.BENCHMARK_BURST === "1";
const rate = Number(__ENV.BENCHMARK_RATE || 0);
const batch = Number(__ENV.BENCHMARK_BATCH || 1);
export const options = {
  ...(rate
    ? {
        scenarios: {
          ingest: {
            executor: "constant-arrival-rate",
            rate: rate / batch,
            timeUnit: "1s",
            duration: "60s",
            preAllocatedVUs: 128,
            maxVUs: 256
          }
        }
      }
    : { vus: Number(__ENV.BENCHMARK_VUS || 4), duration: "60s" }),
  thresholds: {
    checks: ["rate==1"],
    ...(burst ? {} : { http_req_failed: ["rate==0"] }),
    ingest_bus_ms: ["p(95)<1000"],
    ingest_operation_ms: ["p(95)<1000"],
    ingest_completed: ["count>1000"]
  }
};
export default function () {
  refused.add(0);
  const response = http.post(`${__ENV.BENCHMARK_URL}/event`, null, { timeout: "10s" });
  if (response.status === 503) {
    const result = response.json();
    if (
      burst &&
      check(result, {
        "bounded capacity refusal": (r) => r.reason === "ingestor_capacity" && r.events === batch
      })
    ) {
      refused.add(batch);
    } else if (!burst) {
      refused.add(result.events || 0);
      check(response, { "persisted and published": (r) => r.status === 200 });
    }
    return;
  }
  if (check(response, { "persisted and published": (r) => r.status === 200 })) {
    const result = response.json();
    for (const event of result.events || [result]) {
      bus.add(event.busMs);
      operation.add(event.operationMs);
      completed.add(1);
    }
  }
}
