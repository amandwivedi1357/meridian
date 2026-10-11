import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { expect, it } from "vitest";
import { registerApiAuth } from "../../app/auth.js";
import { registerWorkerHealth } from "./worker-health.js";

it("exposes bounded read-only worker health behind viewer authentication", async () => {
  const server = Fastify();
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  registerApiAuth(server, { viewerToken: "v".repeat(32) });
  registerWorkerHealth(server, () => ({
    status: "ready",
    lastSuccessfulTickAtMs: 100000,
    activeChildren: 0
  }));
  try {
    expect((await server.inject("/api/system/backtest-worker")).statusCode).toBe(401);
    const reply = await server.inject({
      url: "/api/system/backtest-worker",
      headers: { authorization: `Bearer ${"v".repeat(32)}` }
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.headers["cache-control"]).toBe("no-store");
    expect(reply.json()).toEqual({
      status: "ready",
      lastSuccessfulTickAtMs: 100000,
      activeChildren: 0
    });
  } finally {
    await server.close();
  }
});
