/* global __ENV */
import http from "k6/http";
import { check } from "k6";
import { Trend, Counter } from "k6/metrics";

const bus = new Trend("ingest_bus_ms", true);
const operation = new Trend("ingest_operation_ms", true);
const completed = new Counter("ingest_completed");
export const options = {
  vus: 4,
  duration: "60s",
  thresholds: {
    checks: ["rate==1"],
    http_req_failed: ["rate==0"],
    ingest_bus_ms: ["p(95)<1000"],
    ingest_operation_ms: ["p(95)<1000"],
    ingest_completed: ["count>1000"]
  }
};
export default function () {
  const response = http.post(`${__ENV.BENCHMARK_URL}/event`, null, { timeout: "10s" });
  if (check(response, { "persisted and published": (r) => r.status === 200 })) {
    const result = response.json();
    bus.add(result.busMs);
    operation.add(result.operationMs);
    completed.add(1);
  }
}
