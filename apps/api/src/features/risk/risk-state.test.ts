import Fastify from "fastify";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { registerRiskStateRoutes } from "./risk-state.js";

describe("risk state API", () => {
  function setup(options: { fail?: boolean; emptyControl?: boolean } = {}) {
    const server = Fastify();
    const query = vi.fn(async (sql: string) => {
      if (options.fail) throw new Error("database unavailable");
      if (sql.includes("FROM risk_control_state")) {
        return {
          rows: options.emptyControl
            ? []
            : [
                {
                  scope: "global",
                  engaged: false,
                  reason: "operator-reset",
                  updated_at_ms: "1791622300000"
                }
              ]
        };
      }
      if (sql.includes("FROM risk_equity_state")) {
        return {
          rows: [
            {
              scope: "global",
              quote_asset: "USDT",
              peak: "100.003518",
              updated_at_ms: "1791622376000"
            }
          ]
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    registerRiskStateRoutes(server, { query } as unknown as Pool);
    return { server };
  }

  it("returns kill-switch/risk control state and equity peaks", async () => {
    const { server } = setup();
    try {
      const response = await server.inject({ method: "GET", url: "/api/risk/state" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toMatchObject({
        control: {
          scope: "global",
          engaged: false,
          reason: "operator-reset",
          updatedAtMs: 1_791_622_300_000
        },
        equity: [
          {
            scope: "global",
            quoteAsset: "USDT",
            peak: "100.003518",
            updatedAtMs: 1_791_622_376_000
          }
        ]
      });
    } finally {
      await server.close();
    }
  });

  it("allows missing control state to surface as null instead of inventing safety state", async () => {
    const { server } = setup({ emptyControl: true });
    try {
      const response = await server.inject({ method: "GET", url: "/api/risk/state" });
      expect(response.statusCode).toBe(200);
      expect(response.json().control).toBeNull();
    } finally {
      await server.close();
    }
  });

  it("reports database failures with a sanitized 503", async () => {
    const { server } = setup({ fail: true });
    try {
      const response = await server.inject({ method: "GET", url: "/api/risk/state" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        error: "risk_state_unavailable",
        message: "Risk state is unavailable"
      });
      expect(response.body).not.toMatch(/database unavailable|postgres:\/\//);
    } finally {
      await server.close();
    }
  });
});
