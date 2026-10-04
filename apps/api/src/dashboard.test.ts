import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { Pool } from "pg";
import { feedStatus, parseTrade, registerDashboard } from "./dashboard.js";

describe("dashboard market data", () => {
  const trade = {
    tradeId: "123",
    price: "85123.45000000",
    quantity: "0.00000100",
    eventTimeMs: 1000,
    isBuyerMaker: true
  };
  it("preserves decimal strings and reports the aggressor side", () => {
    expect(parseTrade(JSON.stringify({ kind: "trade", symbol: "BTCUSDT", trade }))).toEqual({
      id: "123",
      time: 1000,
      price: "85123.45000000",
      quantity: "0.00000100",
      side: "sell"
    });
    expect(
      parseTrade(
        JSON.stringify({
          kind: "trade",
          symbol: "BTCUSDT",
          trade: { ...trade, isBuyerMaker: false }
        })
      )?.side
    ).toBe("buy");
  });
  it("rejects corrupt data rather than displaying fabricated prices", () => {
    for (const payload of [
      "broken",
      "null",
      JSON.stringify({ kind: "depth" }),
      JSON.stringify({ kind: "trade", symbol: "BTCUSDT", trade: { ...trade, price: "NaN" } })
    ]) {
      expect(parseTrade(payload)).toBeNull();
    }
  });
  it("distinguishes live, stale, and missing data", () => {
    expect(feedStatus(null, 30_000)).toBe("waiting");
    expect(feedStatus(20_000, 30_000)).toBe("live");
    expect(feedStatus(1000, 30_000)).toBe("stale");
  });
});

describe("dashboard endpoint", () => {
  function setup(available = true) {
    const server = Fastify();
    const redis = {
      xRevRange: vi.fn(async () => {
        if (!available) throw new Error("Redis unavailable");
        return [
          {
            message: {
              payload: JSON.stringify({
                kind: "trade",
                symbol: "BTCUSDT",
                trade: {
                  tradeId: "1",
                  price: "85000.01",
                  quantity: "0.001",
                  eventTimeMs: Date.now(),
                  isBuyerMaker: false
                }
              })
            }
          }
        ];
      }),
      xLen: vi.fn(async () => 42),
      info: vi.fn(async () => "used_memory:1024\r\n")
    };
    const query = vi.fn(async () => {
      if (!available) throw new Error("Database unavailable");
      return { rows: [{ count: "40" }] };
    });
    registerDashboard(
      server,
      redis,
      { query } as unknown as Pool,
      "./missing-dashboard-test-workspace"
    );
    return { server, redis, query };
  }

  it("returns real counts and decimal strings, without exposing connection details", async () => {
    const { server } = setup();
    try {
      const response = await server.inject({ method: "GET", url: "/api/dashboard" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      const data = response.json();
      expect(data.feed).toBe("live");
      expect(data.redis).toEqual({ available: true, count: 42, memoryBytes: 1024 });
      expect(data.database.count).toBe(40);
      expect(data.trades[0].price).toBe("85000.01");
      expect(data.recording).toBeNull();
      expect(data.soak.completed).toBe(false);
      expect(response.body).not.toMatch(/postgres:\/\/|redis:\/\//);
    } finally {
      await server.close();
    }
  });

  it("refreshes stream data while caching expensive database counts", async () => {
    const { server, query, redis } = setup();
    try {
      await server.inject({ method: "GET", url: "/api/dashboard" });
      await server.inject({ method: "GET", url: "/api/dashboard" });
      expect(query).toHaveBeenCalledTimes(1);
      expect(redis.xRevRange).toHaveBeenCalledTimes(2);
    } finally {
      await server.close();
    }
  });

  it("reports unavailable services without inventing zero counts or a successful soak", async () => {
    const { server } = setup(false);
    try {
      const response = await server.inject({ method: "GET", url: "/api/dashboard" });
      const data = response.json();
      expect(response.statusCode).toBe(200);
      expect(data.redis.available).toBe(false);
      expect(data.redis.count).toBeNull();
      expect(data.database.available).toBe(false);
      expect(data.database.count).toBeNull();
      expect(data.feed).toBe("waiting");
      expect(data.trades).toEqual([]);
      expect(data.soak.status).toBe("attention");
      expect(data.soak.completed).toBe(false);
    } finally {
      await server.close();
    }
  });
});
