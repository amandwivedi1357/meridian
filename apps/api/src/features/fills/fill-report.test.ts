import Fastify from "fastify";
import type { Pool } from "pg";
import { it, expect, vi } from "vitest";
import { registerFillsRoutes } from "./fills.js";
it("does not expose a partial ledger as complete when the report bound is exceeded", async () => {
  const query = vi.fn(async (sql: string) => {
    expect(sql).toContain("LIMIT 10001");
    return { rows: Array(10001).fill({}) };
  });
  const app = Fastify();
  registerFillsRoutes(app, { query } as unknown as Pool);
  try {
    const response = await app.inject({ method: "GET", url: "/api/fills/report" });
    expect(response.json()).toMatchObject({ complete: false, fills: [] });
    expect(query.mock.calls[0]?.[0]).toContain("LIMIT 10001");
  } finally {
    await app.close();
  }
});
it("returns a complete empty ledger without creating simulated history", async () => {
  const app = Fastify();
  registerFillsRoutes(app, { query: async () => ({ rows: [] }) } as unknown as Pool);
  try {
    expect((await app.inject({ method: "GET", url: "/api/fills/report" })).json()).toMatchObject({
      complete: true,
      fills: []
    });
  } finally {
    await app.close();
  }
});
