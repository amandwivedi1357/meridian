import { afterEach, describe, expect, it, vi } from "vitest";
import { Registry } from "prom-client";
import { createServiceDiagnostics, diagnosticsAddress } from "./service-diagnostics.js";

const servers: ReturnType<typeof createServiceDiagnostics>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
async function fixture(checkReady: () => boolean | Promise<boolean> = () => true, timeoutMs = 30) {
  const registry = new Registry();
  registry.setDefaultLabels({ service: "fixture" });
  const server = createServiceDiagnostics({ service: "fixture", registry, checkReady, timeoutMs });
  servers.push(server);
  const address = await server.listen({ host: "127.0.0.1", port: 0 });
  if (!address || typeof address === "string") throw new Error("Missing listener");
  return { server, registry, url: `http://127.0.0.1:${address.port}` };
}
describe("service diagnostics", () => {
  it("keeps endpoints private by default and validates config", () => {
    expect(diagnosticsAddress("api", {})).toEqual({ host: "127.0.0.1", port: 9400 });
    expect(() => diagnosticsAddress("api", { API_DIAGNOSTICS_PORT: "0" })).toThrow();
    expect(() => diagnosticsAddress("api", { DIAGNOSTICS_HOST: "example.com" })).toThrow();
  });
  it("distinguishes startup, readiness and draining", async () => {
    const { server, url } = await fixture();
    expect((await fetch(`${url}/health/live`)).status).toBe(200);
    expect((await fetch(`${url}/health/ready`)).status).toBe(503);
    server.started();
    expect((await fetch(`${url}/health/ready`)).status).toBe(200);
    server.stopping();
    expect((await fetch(`${url}/health/ready`)).status).toBe(503);
    expect((await fetch(`${url}/health/live`)).status).toBe(503);
    await Promise.all([server.close(), server.close()]);
  });
  it("times out and shares stuck checks without leaking errors", async () => {
    const check = vi.fn(() => new Promise<boolean>(() => {}));
    const { server } = await fixture(check, 5);
    server.started();
    expect(await Promise.all([server.ready(), server.ready()])).toEqual([false, false]);
    expect(await server.ready()).toBe(false);
    expect(check).toHaveBeenCalledTimes(1);
    const failed = await fixture(() => {
      throw new Error("secret-password");
    });
    failed.server.started();
    const response = await fetch(`${failed.url}/health/ready`);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret-password");
  });
  it("exports bounded work metrics, errors and route behavior", async () => {
    const { server, url } = await fixture();
    server.started();
    expect(
      await server.measure(
        "market_poll",
        async () => 3,
        (n) => n
      )
    ).toBe(3);
    await expect(
      server.measure("market_poll", async () => {
        throw new Error("failed");
      })
    ).rejects.toThrow("failed");
    const metrics = await (await fetch(`${url}/metrics`)).text();
    expect(metrics).toContain(
      'meridian_work_items_total{operation="market_poll",service="fixture"} 3'
    );
    expect(metrics).toContain(
      'meridian_work_failures_total{operation="market_poll",service="fixture"} 1'
    );
    expect((await fetch(`${url}/other`)).status).toBe(404);
    expect((await fetch(`${url}/metrics`, { method: "POST" })).status).toBe(405);
    expect(await (await fetch(`${url}/health/live`, { method: "HEAD" })).text()).toBe("");
  });
});
