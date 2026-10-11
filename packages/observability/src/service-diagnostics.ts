import { createServer, type Server } from "node:http";
import { Counter, Gauge, Histogram, type Registry } from "prom-client";

export function diagnosticsAddress(
  service: "api" | "ingestor" | "engine" | "executor",
  env: Record<string, string | undefined> = process.env
) {
  const defaults = { api: 9400, ingestor: 9401, engine: 9402, executor: 9403 };
  const value = env[`${service.toUpperCase()}_DIAGNOSTICS_PORT`];
  const port = value === undefined ? defaults[service] : Number(value);
  const host = env.DIAGNOSTICS_HOST ?? "127.0.0.1";
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    (value !== undefined && !/^\d+$/.test(value))
  )
    throw new Error("Invalid diagnostics port");
  if (host !== "127.0.0.1" && host !== "0.0.0.0") throw new Error("Invalid diagnostics host");
  return { host, port };
}

export function createServiceDiagnostics(options: {
  service: string;
  registry: Registry;
  checkReady: () => boolean | Promise<boolean>;
  timeoutMs?: number;
}) {
  const readyGauge = new Gauge({
    name: "meridian_service_ready",
    help: "Service startup, dependencies and runtime readiness (not trading permission)",
    registers: [options.registry]
  });
  const stoppingGauge = new Gauge({
    name: "meridian_service_stopping",
    help: "Service is draining and no longer ready",
    registers: [options.registry]
  });
  const failures = new Counter({
    name: "meridian_work_failures_total",
    help: "Runtime operation failures with bounded operation labels",
    labelNames: ["operation"],
    registers: [options.registry]
  });
  const work = new Counter({
    name: "meridian_work_items_total",
    help: "Completed work items",
    labelNames: ["operation"],
    registers: [options.registry]
  });
  const duration = new Histogram({
    name: "meridian_work_duration_seconds",
    help: "Runtime operation duration including errors",
    labelNames: ["operation"],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.5, 1, 5],
    registers: [options.registry]
  });
  let stopping = false;
  let initialized = false;
  let server: Server | undefined;
  let pending: Promise<boolean> | undefined;
  let closePromise: Promise<void> | undefined;
  readyGauge.set(0);
  stoppingGauge.set(0);
  async function ready(): Promise<boolean> {
    if (!initialized || stopping) {
      readyGauge.set(0);
      return false;
    }
    // Share even a stuck dependency check, so repeated probes cannot accumulate work.
    pending ??= Promise.resolve()
      .then(options.checkReady)
      .then(Boolean)
      .catch(() => false)
      .finally(() => {
        pending = undefined;
      });
    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        pending,
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), options.timeoutMs ?? 2000);
        })
      ]);
      const healthy = !stopping && result;
      readyGauge.set(healthy ? 1 : 0);
      return healthy;
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    ready,
    started() {
      if (!stopping) initialized = true;
    },
    stopping() {
      stopping = true;
      stoppingGauge.set(1);
      readyGauge.set(0);
    },
    async measure<T>(
      operation: "market_poll" | "signal_poll" | "signal_reclaim" | "ingest",
      run: () => Promise<T>,
      count: (result: T) => number = () => 1
    ): Promise<T> {
      const end = duration.startTimer({ operation });
      try {
        const result = await run();
        const n = count(result);
        if (Number.isSafeInteger(n) && n >= 0) work.inc({ operation }, n);
        return result;
      } catch (error) {
        failures.inc({ operation });
        throw error;
      } finally {
        end();
      }
    },
    async listen(address: { host: string; port: number }) {
      if (server || stopping) throw new Error("Diagnostics already started or stopping");
      server = createServer((request, response) => {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.writeHead(405, { Allow: "GET, HEAD" });
          response.end();
          return;
        }
        void (async () => {
          if (request.url === "/metrics") {
            await ready();
            const metrics = await options.registry.metrics();
            response.writeHead(200, { "Content-Type": options.registry.contentType });
            response.end(metrics);
          } else if (request.url === "/health/live" || request.url === "/health/ready") {
            const healthy = request.url === "/health/live" ? !stopping : await ready();
            response.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
            response.end(
              JSON.stringify({ service: options.service, status: healthy ? "ok" : "unavailable" })
            );
          } else {
            response.writeHead(404);
            response.end();
          }
        })().catch(() => {
          if (!response.headersSent) response.writeHead(503);
          response.end();
        });
      });
      server.requestTimeout = 5000;
      server.headersTimeout = 5000;
      await new Promise<void>((resolve, reject) => {
        server!.once("error", reject);
        server!.listen(address.port, address.host, () => {
          server!.off("error", reject);
          resolve();
        });
      });
      return server.address();
    },
    close(): Promise<void> {
      stopping = true;
      readyGauge.set(0);
      stoppingGauge.set(1);
      closePromise ??= new Promise<void>((resolve) => {
        if (!server || !server.listening) {
          resolve();
          return;
        }
        const force = setTimeout(() => server?.closeAllConnections(), 250);
        server.close(() => {
          clearTimeout(force);
          resolve();
        });
        server.closeIdleConnections();
      });
      return closePromise;
    }
  };
}
