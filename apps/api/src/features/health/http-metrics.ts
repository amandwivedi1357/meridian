import type { FastifyInstance } from "fastify";
import { Counter, Histogram, type Registry } from "@meridian/observability";

export function registerHttpMetrics(server: FastifyInstance, registry: Registry) {
  const requests = new Counter({
    name: "meridian_http_requests_total",
    help: "Completed API requests by registered route template, method and status",
    labelNames: ["route", "method", "status"],
    registers: [registry]
  });
  const duration = new Histogram({
    name: "meridian_http_duration_seconds",
    help: "API request lifetime; SSE includes time until stream close",
    labelNames: ["route", "method"],
    registers: [registry]
  });
  const started = new WeakMap<object, number>();
  server.addHook("onRequest", async (request) => {
    started.set(request, performance.now());
  });
  server.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions.url ?? "unmatched";
    const method = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(
      request.method
    )
      ? request.method
      : "OTHER";
    requests.inc({ route, method, status: String(reply.statusCode) });
    const time = started.get(request);
    if (time !== undefined) duration.observe({ route, method }, (performance.now() - time) / 1000);
  });
}
