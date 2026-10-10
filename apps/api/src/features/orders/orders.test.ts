import Fastify from "fastify";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { registerOrdersRoutes } from "./orders.js";

describe("orders API", () => {
  function setup(options: { fail?: boolean } = {}) {
    const server = Fastify();
    const query = vi.fn(async () => {
      if (options.fail) throw new Error("database unavailable");
      return {
        rows: [
          {
            client_order_id: "order_1",
            strategy_id: "ema-live",
            signal_id: "signal_1",
            symbol: "BTCUSDT",
            side: "BUY",
            type: "LIMIT",
            state: "FILLED",
            quantity: "0.0002",
            limit_price: "82835.62",
            executed_quantity: "0.0002",
            cumulative_quote_quantity: "16.56712400",
            exchange_order_id: "1121577",
            created_at_ms: "1791622374000",
            updated_at_ms: "1791622375000"
          }
        ]
      };
    });

    registerOrdersRoutes(server, { query } as unknown as Pool);
    return { server, query };
  }

  it("returns recent orders with decimal values preserved as strings", async () => {
    const { server } = setup();
    try {
      const response = await server.inject({ method: "GET", url: "/api/orders" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toMatchObject({
        orders: [
          {
            clientOrderId: "order_1",
            strategyId: "ema-live",
            signalId: "signal_1",
            symbol: "BTCUSDT",
            side: "BUY",
            type: "LIMIT",
            state: "FILLED",
            quantity: "0.0002",
            limitPrice: "82835.62",
            executedQuantity: "0.0002",
            cumulativeQuoteQuantity: "16.56712400",
            exchangeOrderId: "1121577",
            createdAtMs: 1_791_622_374_000,
            updatedAtMs: 1_791_622_375_000
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
      const response = await server.inject({ method: "GET", url: "/api/orders?limit=5000" });
      expect(response.statusCode).toBe(200);
      expect(query).toHaveBeenCalledWith(expect.stringContaining("LIMIT $1"), [100]);
    } finally {
      await server.close();
    }
  });

  it("reports database failures without leaking internal errors", async () => {
    const { server } = setup({ fail: true });
    try {
      const response = await server.inject({ method: "GET", url: "/api/orders" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        error: "orders_unavailable",
        message: "Orders are unavailable"
      });
      expect(response.body).not.toMatch(/database unavailable|postgres:\/\//);
    } finally {
      await server.close();
    }
  });
});
