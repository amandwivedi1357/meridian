import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { describe, expect, it, vi } from "vitest";
import { registerApiAuth } from "../../app/auth.js";
import { createSystemHealthReader, parseGroups, registerSystemHealth } from "./system-health.js";

describe("system health", () => {
  it("keeps undelivered lag distinct from pending and preserves unknown lag", () => {
    expect(parseGroups([["name", "engine", "consumers", 1, "pending", 3, "lag", 12]])).toEqual([
      { name: "engine", consumers: 1, pending: 3, lag: 12 }
    ]);
    expect(
      parseGroups([["name", "engine", "consumers", 0, "pending", 0, "lag", null]])[0]?.lag
    ).toBeNull();
    expect(parseGroups([["name", "legacy", "consumers", 0, "pending", 0]])[0]?.lag).toBeNull();
    expect(() => parseGroups([["name", "broken", "consumers", -1, "pending", 0]])).toThrow();
    expect(() => parseGroups(new Array(51).fill([]))).toThrow();
  });
  it("coalesces reads and caches across clients for five seconds without scanning keys", async () => {
    let now = 10000;
    const command = vi.fn(async (args: string[]) => (args[0] === "PING" ? "PONG" : 0));
    const database = vi.fn(async () => ({}));
    const read = createSystemHealthReader({ command, database, now: () => now });
    const [first, second] = await Promise.all([read(), read()]);
    expect(first).toBe(second);
    expect(first.streams.every((s) => s.status === "missing" && s.length === null)).toBe(true);
    expect(command).toHaveBeenCalledTimes(8);
    await read();
    expect(database).toHaveBeenCalledOnce();
    now += 5000;
    await read();
    expect(database).toHaveBeenCalledTimes(2);
    expect(command.mock.calls.some(([args]) => ["SCAN", "KEYS"].includes(args[0]!))).toBe(false);
  });
  it("reports independent infrastructure failures without substituting zero lag", async () => {
    const read = createSystemHealthReader({
      command: async () => {
        throw new Error("secret connection details");
      },
      database: async () => {
        throw new Error("database credentials");
      }
    });
    const health = await read();
    expect(health.redis).toBe("unavailable");
    expect(health.database).toBe("unavailable");
    expect(health.streams.every((s) => s.status === "unavailable" && s.groups.length === 0)).toBe(
      true
    );
    expect(JSON.stringify(health)).not.toMatch(/secret|credentials/);
  });
  it("isolates malformed group replies and per-stream races", async () => {
    const read = createSystemHealthReader({
      command: async (args) => {
        if (args[0] === "PING") return "PONG";
        if (args[0] === "EXISTS") return 1;
        if (args[0] === "XLEN") return 12;
        if (args[2] === "signals") throw new Error("stream removed");
        return [["name", "engine", "consumers", 1, "pending", 2, "lag", 0]];
      },
      database: async () => ({})
    });
    const health = await read();
    expect(health.streams[0]?.groups[0]?.lag).toBe(0);
    expect(health.streams.at(-1)?.status).toBe("unavailable");
  });
  it("protects read-only REST health with existing viewer auth", async () => {
    const server = Fastify();
    server.setValidatorCompiler(validatorCompiler);
    server.setSerializerCompiler(serializerCompiler);
    registerApiAuth(server, { viewerToken: "v".repeat(32) });
    const read = createSystemHealthReader({ command: async () => 0, database: async () => ({}) });
    registerSystemHealth(server, read);
    try {
      expect((await server.inject("/api/system/health")).statusCode).toBe(401);
      const response = await server.inject({
        url: "/api/system/health",
        headers: { authorization: `Bearer ${"v".repeat(32)}` }
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json().streams).toHaveLength(7);
    } finally {
      await server.close();
    }
  });
});
