import Fastify from "fastify";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { registerMarketCandlesRoutes } from "./candles.js";

describe("market candles API", () => {
  function setup(options: { fail?: boolean } = {}) {
    const server = Fastify();
    const query = vi.fn(async () => {
      if (options.fail) throw new Error("database unavailable");
      return {
        rows: [
          {
            symbol: "BTCUSDT",
            interval: "15m",
            open_time_ms: "1791630000000",
            close_time_ms: "1791630899999",
            open: "85920.10",
            high: "85980.50",
            low: "85890.25",
            close: "85947.87",
            volume: "4.8123",
            closed: true
          }
        ]
      };
    });
    registerMarketCandlesRoutes(server, { query } as unknown as Pool);
    return { server, query };
  }

  it("returns asc ordered candles with decimal strings preserved", async () => {
    const { server, query } = setup();
    try {
      const response = await server.inject({
        method: "GET",
        url: "/api/market/candles?symbol=btcusdt&interval=15m&limit=50"
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM klines"), [
        "BTCUSDT",
        "15m",
        50
      ]);
      expect(response.json()).toMatchObject({
        symbol: "BTCUSDT",
        interval: "15m",
        candles: [
          {
            openTimeMs: 1_791_630_000_000,
            closeTimeMs: 1_791_630_899_999,
            open: "85920.10",
            high: "85980.50",
            low: "85890.25",
            close: "85947.87",
            volume: "4.8123",
            closed: true
          }
        ]
      });
    } finally {
      await server.close();
    }
  });

  it("validates symbol, interval, and limit", async () => {
    const { server } = setup();
    try {
      const badInterval = await server.inject({
        method: "GET",
        url: "/api/market/candles?symbol=BTCUSDT&interval=2m"
      });
      expect(badInterval.statusCode).toBe(400);

      const badLimit = await server.inject({
        method: "GET",
        url: "/api/market/candles?symbol=BTCUSDT&limit=-1"
      });
      expect(badLimit.statusCode).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("reports database failures without leaking internals", async () => {
    const { server } = setup({ fail: true });
    try {
      const response = await server.inject({
        method: "GET",
        url: "/api/market/candles?symbol=BTCUSDT&interval=15m"
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        error: "candles_unavailable",
        message: "Market candles are unavailable"
      });
      expect(response.body).not.toMatch(/database unavailable|postgres:\/\//);
    } finally {
      await server.close();
    }
  });
});
