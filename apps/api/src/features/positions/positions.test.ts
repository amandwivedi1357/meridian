import Fastify from "fastify";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { registerPositionsRoutes } from "./positions.js";
import { createPortfolioReader } from "../account/portfolio.js";

describe("positions API", () => {
  function setup(options: { fail?: boolean } = {}) {
    const server = Fastify();
    const query = vi.fn(async () => {
      if (options.fail) throw new Error("database unavailable");
      return {
        rows: [
          {
            symbol: "BTCUSDT",
            side: "BUY",
            quantity: "0.0002",
            price: "82835.62",
            fee: "0",
            fee_asset: "USDT",
            event_time_ms: "1791622376011"
          },
          {
            symbol: "BTCUSDT",
            side: "SELL",
            quantity: "0.0002",
            price: "82835.61",
            fee: "0",
            fee_asset: "USDT",
            event_time_ms: "1791622376012"
          }
        ]
      };
    });

    registerPositionsRoutes(
      server,
      createPortfolioReader(
        { query } as unknown as Pool,
        {
          metadata: async () => [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" }],
          mark: async () => {
            throw new Error("flat positions need no mark");
          }
        },
        "testnet",
        () => 1791622380000
      )
    );
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
            quantity: "0",
            boughtQuantity: "0.0002",
            soldQuantity: "0.0002",
            buyQuote: "16.567124",
            sellQuote: "16.567122",
            realizedPnl: "-0.000002",
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
