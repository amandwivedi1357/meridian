import Fastify from "fastify";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { registerAccountSummaryRoutes } from "./account-summary.js";

describe("account summary API", () => {
  function setup(options: { fail?: boolean } = {}) {
    const server = Fastify();
    const query = vi.fn(async (sql: string) => {
      if (options.fail) throw new Error("database unavailable");
      if (sql.includes("COUNT(*)::text AS count FROM orders")) return { rows: [{ count: "4" }] };
      if (sql.includes("GROUP BY state")) {
        return {
          rows: [
            { state: "FILLED", count: "2" },
            { state: "CANCELED", count: "1" }
          ]
        };
      }
      if (sql.includes("COUNT(*)::text AS count FROM order_fills")) {
        return { rows: [{ count: "2" }] };
      }
      if (sql.includes("FROM risk_control_state")) {
        return {
          rows: [
            {
              scope: "global",
              engaged: true,
              reason: "manual-kill",
              updated_at_ms: "1791622300000"
            }
          ]
        };
      }
      if (sql.includes("FROM order_fills") && sql.includes("GROUP BY symbol")) {
        return {
          rows: [{ symbol: "BTCUSDT", quantity: "0.0000", fill_count: "2" }]
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    registerAccountSummaryRoutes(server, { query } as unknown as Pool);
    return { server };
  }

  it("returns high-level account and risk summary for dashboard cards", async () => {
    const { server } = setup();
    try {
      const response = await server.inject({ method: "GET", url: "/api/account/summary" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toMatchObject({
        orderCount: 4,
        fillCount: 2,
        ordersByState: {
          FILLED: 2,
          CANCELED: 1
        },
        riskControl: {
          scope: "global",
          engaged: true,
          reason: "manual-kill",
          updatedAtMs: 1_791_622_300_000
        },
        positions: [{ symbol: "BTCUSDT", quantity: "0.0000", fillCount: 2 }]
      });
    } finally {
      await server.close();
    }
  });

  it("reports database failures with a sanitized 503", async () => {
    const { server } = setup({ fail: true });
    try {
      const response = await server.inject({ method: "GET", url: "/api/account/summary" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        error: "account_summary_unavailable",
        message: "Account summary is unavailable"
      });
      expect(response.body).not.toMatch(/database unavailable|postgres:\/\//);
    } finally {
      await server.close();
    }
  });
});
