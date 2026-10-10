import Fastify from "fastify";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { registerStrategiesRoutes } from "./strategies.js";

describe("strategies API", () => {
  function setup(options: { fail?: boolean } = {}) {
    const server = Fastify();
    const query = vi.fn(async () => {
      if (options.fail) throw new Error("database unavailable");
      return {
        rows: [
          {
            strategy_id: "ema-live",
            paused: true,
            reason: "pause for inspection",
            updated_at_ms: "1791622376000"
          },
          {
            strategy_id: "grid-live",
            paused: false,
            reason: "operator-resume",
            updated_at_ms: "1791622380000"
          }
        ]
      };
    });

    registerStrategiesRoutes(server, { query } as unknown as Pool);
    return { server, query };
  }

  it("returns strategy control state ordered by strategy id", async () => {
    const { server, query } = setup();
    try {
      const response = await server.inject({ method: "GET", url: "/api/strategies" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(query).toHaveBeenCalledWith(expect.stringContaining("ORDER BY strategy_id ASC"));
      expect(response.json()).toMatchObject({
        strategies: [
          {
            strategyId: "ema-live",
            paused: true,
            reason: "pause for inspection",
            updatedAtMs: 1_791_622_376_000
          },
          {
            strategyId: "grid-live",
            paused: false,
            reason: "operator-resume",
            updatedAtMs: 1_791_622_380_000
          }
        ]
      });
      expect(response.body).not.toMatch(/postgres:\/\/|redis:\/\//);
    } finally {
      await server.close();
    }
  });

  it("reports database failures with a sanitized 503", async () => {
    const { server } = setup({ fail: true });
    try {
      const response = await server.inject({ method: "GET", url: "/api/strategies" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        error: "strategies_unavailable",
        message: "Strategies are unavailable"
      });
      expect(response.body).not.toMatch(/database unavailable|postgres:\/\//);
    } finally {
      await server.close();
    }
  });
});
