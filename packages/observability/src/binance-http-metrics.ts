import { Counter, Gauge, Histogram, type Registry } from "prom-client";

export function createBinanceMetricsFetch(
  registry: Registry,
  request: typeof globalThis.fetch = globalThis.fetch
): typeof globalThis.fetch {
  const statuses = new Counter({
    name: "binance_http_status_total",
    help: "Observed Binance REST responses; each actual request attempt is counted",
    labelNames: ["environment", "code"],
    registers: [registry]
  });
  const errors = new Counter({
    name: "binance_transport_errors_total",
    help: "Binance REST requests without an HTTP response",
    labelNames: ["environment"],
    registers: [registry]
  });
  const throttled = new Gauge({
    name: "meridian_binance_throttle_timestamp_seconds",
    help: "Timestamp of last observed Binance HTTP 418/429, including first failure before a baseline scrape",
    labelNames: ["environment"],
    registers: [registry]
  });
  const weight = new Gauge({
    name: "binance_used_weight",
    help: "Last observed X-MBX-USED-WEIGHT-1M IP usage, not an API-key-specific quota",
    labelNames: ["environment"],
    registers: [registry]
  });
  const sampled = new Gauge({
    name: "meridian_binance_weight_sample_timestamp_seconds",
    help: "Timestamp of valid one-minute weight header observation",
    labelNames: ["environment"],
    registers: [registry]
  });
  const latency = new Histogram({
    name: "binance_http_request_duration_seconds",
    help: "REST fetch time to response headers including failures; not fill latency",
    labelNames: ["environment"],
    registers: [registry],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 3, 10]
  });
  return async (input, init) => {
    let environment: "testnet" | "production" | undefined;
    try {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.protocol === "https:") {
        if (url.hostname === "testnet.binance.vision") environment = "testnet";
        else if (url.hostname === "api.binance.com") environment = "production";
      }
    } catch {
      /* Invalid/non-Binance inputs keep normal fetch semantics without labels. */
    }
    if (!environment) return request(input, init);
    const labels = { environment };
    const end = latency.startTimer(labels);
    try {
      const response = await request(input, init);
      statuses.inc({ ...labels, code: String(response.status) });
      if (response.status === 418 || response.status === 429)
        throttled.set(labels, Date.now() / 1000);
      const header = response.headers.get("x-mbx-used-weight-1m");
      if (header !== null && /^\d+$/.test(header) && Number.isSafeInteger(Number(header))) {
        weight.set(labels, Number(header));
        sampled.set(labels, Date.now() / 1000);
      } else {
        weight.remove(labels);
        sampled.remove(labels);
      }
      return response;
    } catch (error) {
      errors.inc(labels);
      throw error;
    } finally {
      end();
    }
  };
}
