import Fastify from "fastify";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { registerFillsRoutes } from "./fills.js";

describe("fills API", () => {
  function setup(options: { fail?: boolean } = {}) {
    const server = Fastify();
    const query = vi.fn(async () => {
      if (options.fail) throw new Error("database unavailable");
      return {
        rows: [
          {
            client_order_id: "order_1",
            strategy_id: "ema-live",
            execution_id: "rest:211165",
            trade_id: "211165",
            symbol: "BTCUSDT",
            side: "BUY",
            quantity: "0.0002",
            price: "82835.62",
            fee: "0",
            fee_asset: "BTC",
            event_time_ms: "1791622374905"
          }
        ]
      };
    });

    registerFillsRoutes(server, { query } as unknown as Pool);
    return { server, query };
  }

  it("returns recent fills with decimal values preserved as strings", async () => {
    const { server } = setup();
    try {
      const response = await server.inject({ method: "GET", url: "/api/fills" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toMatchObject({
        fills: [
          {
            clientOrderId: "order_1",
            strategyId: "ema-live",
            executionId: "rest:211165",
            tradeId: "211165",
            symbol: "BTCUSDT",
            side: "BUY",
            quantity: "0.0002",
            price: "82835.62",
            fee: "0",
            feeAsset: "BTC",
            eventTimeMs: 1_791_622_374_905
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
      const response = await server.inject({ method: "GET", url: "/api/fills?limit=5000" });
      expect(response.statusCode).toBe(200);
      expect(query).toHaveBeenCalledWith(expect.stringContaining("LIMIT $1"), [100]);
    } finally {
      await server.close();
    }
  });

  it("reports database failures without leaking internal errors", async () => {
    const { server } = setup({ fail: true });
    try {
      const response = await server.inject({ method: "GET", url: "/api/fills" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        error: "fills_unavailable",
        message: "Fills are unavailable"
      });
      expect(response.body).not.toMatch(/database unavailable|postgres:\/\//);
    } finally {
      await server.close();
    }
  });
});
