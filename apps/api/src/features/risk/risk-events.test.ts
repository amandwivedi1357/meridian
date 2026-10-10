import Fastify from "fastify";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { registerRiskEventsRoutes } from "./risk-events.js";

describe("risk events API", () => {
  function setup(options: { fail?: boolean } = {}) {
    const server = Fastify();
    const query = vi.fn(async () => {
      if (options.fail) throw new Error("database unavailable");
      return {
        rows: [
          {
            id: "7",
            ts_ms: "1791622376000",
            type: "signal-approved",
            details: { symbol: "BTCUSDT", strategyId: "ema-live" }
          }
        ]
      };
    });

    registerRiskEventsRoutes(server, { query } as unknown as Pool);
    return { server, query };
  }

  it("returns recent risk events without leaking internals", async () => {
    const { server } = setup();
    try {
      const response = await server.inject({ method: "GET", url: "/api/risk/events" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toMatchObject({
        events: [
          {
            id: "7",
            tsMs: 1_791_622_376_000,
            type: "signal-approved",
            details: { symbol: "BTCUSDT", strategyId: "ema-live" }
          }
        ]
      });
      expect(response.body).not.toMatch(/postgres:\/\/|redis:\/\//);
    } finally {
      await server.close();
    }
  });

  it("caps caller-provided limits to a safe maximum", async () => {
    const { server, query } = setup();
    try {
      const response = await server.inject({ method: "GET", url: "/api/risk/events?limit=5000" });
      expect(response.statusCode).toBe(200);
      expect(query).toHaveBeenCalledWith(expect.stringContaining("LIMIT $1"), [100]);
    } finally {
      await server.close();
    }
  });

  it("reports database failures with a sanitized 503", async () => {
    const { server } = setup({ fail: true });
    try {
      const response = await server.inject({ method: "GET", url: "/api/risk/events" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        error: "risk_events_unavailable",
        message: "Risk events are unavailable"
      });
      expect(response.body).not.toMatch(/database unavailable|postgres:\/\//);
    } finally {
      await server.close();
    }
  });
});
