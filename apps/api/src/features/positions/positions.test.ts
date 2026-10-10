import Fastify from "fastify";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { registerPositionsRoutes } from "./positions.js";

describe("positions API", () => {
  function setup(options: { fail?: boolean } = {}) {
    const server = Fastify();
    const query = vi.fn(async () => {
      if (options.fail) throw new Error("database unavailable");
      return {
        rows: [
          {
            symbol: "BTCUSDT",
            quantity: "0.0000",
            bought_quantity: "0.0002",
            sold_quantity: "0.0002",
            buy_quote: "16.56712400",
            sell_quote: "16.56712200",
            fill_count: "2",
            last_event_time_ms: "1791622376012"
          }
        ]
      };
    });

    registerPositionsRoutes(server, { query } as unknown as Pool);
    return { server };
  }

  it("returns positions derived from persisted fills", async () => {
    const { server } = setup();
    try {
      const response = await server.inject({ method: "GET", url: "/api/positions" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toMatchObject({
        positions: [
          {
            symbol: "BTCUSDT",
            quantity: "0.0000",
            boughtQuantity: "0.0002",
            soldQuantity: "0.0002",
            buyQuote: "16.56712400",
            sellQuote: "16.56712200",
            fillCount: 2,
            lastEventTimeMs: 1_791_622_376_012
          }
        ]
      });
    } finally {
      await server.close();
    }
  });

  it("reports database failures with a sanitized 503", async () => {
    const { server } = setup({ fail: true });
    try {
      const response = await server.inject({ method: "GET", url: "/api/positions" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        error: "positions_unavailable",
        message: "Positions are unavailable"
      });
      expect(response.body).not.toMatch(/database unavailable|postgres:\/\//);
    } finally {
      await server.close();
    }
  });
});
