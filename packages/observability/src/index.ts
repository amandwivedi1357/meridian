import pino, { type LoggerOptions } from "pino";
import { Registry as PrometheusRegistry, collectDefaultMetrics } from "prom-client";

export { Counter, Gauge, Histogram, Registry } from "prom-client";

const redactPaths = [
  "req.headers.authorization",
  "headers.authorization",
  "BINANCE_API_KEY",
  "BINANCE_API_SECRET",
  "JWT_SECRET",
  "*.signature",
  "*.apiKey"
];

export function createLogger(name: string, options: LoggerOptions = {}) {
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: redactPaths,
      censor: "[redacted]"
    },
    ...options
  });
}

export function createMetricsRegistry(serviceName: string) {
  const registry = new PrometheusRegistry();
  registry.setDefaultLabels({ service: serviceName });
  collectDefaultMetrics({ register: registry });
  return registry;
}
