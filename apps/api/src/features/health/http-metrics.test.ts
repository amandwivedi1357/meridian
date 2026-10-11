import Fastify from "fastify";
import { Registry } from "@meridian/observability";
import { expect, it } from "vitest";
import { registerHttpMetrics } from "./http-metrics.js";

it("uses route templates, never IDs or query credentials, in HTTP labels", async () => {
  const server = Fastify();
  const registry = new Registry();
  registerHttpMetrics(server, registry);
  server.get("/orders/:id", async () => ({ ok: true }));
  try {
    await server.inject("/orders/private-id?token=secret-token");
    await server.inject("/unknown-private-id?token=another-secret");
    const metrics = await registry.metrics();
    expect(metrics).toContain('route="/orders/:id"');
    expect(metrics).toContain('route="unmatched"');
    expect(metrics).not.toMatch(/private-id|secret-token|another-secret/);
  } finally {
    await server.close();
  }
});
