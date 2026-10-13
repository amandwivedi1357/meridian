import Fastify from "fastify";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { parseSignalPayload } from "@meridian/core";

import { registerApiAuth } from "../../app/auth.js";
import { registerManualOrderRoute } from "./manual-order.js";

const viewerToken = "viewer-token-12345678901234567890";
const operatorToken = "operator-token-123456789012345678";

describe("manual order API", () => {
  function setup(options: { failDb?: boolean; failRedis?: boolean } = {}) {
    const server = Fastify();
    registerApiAuth(server, { viewerToken, operatorToken });
    const query = vi.fn(async () => {
      if (options.failDb) throw new Error("database unavailable");
      return { rows: [] };
    });
    const redis = {
      sendCommand: vi.fn(async () => {
        if (options.failRedis) throw new Error("redis unavailable");
        return "1791890000000-0";
      })
    };
    registerManualOrderRoute(server, { query } as unknown as Pool, redis);
    return { server, query, redis };
  }

  it("requires an operator token", async () => {
    const { server } = setup();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/orders/manual",
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: manualOrder()
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("queues a manual market order as a protected signal", async () => {
    const { server, query, redis } = setup();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/orders/manual",
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: manualOrder({ reason: " small test buy " })
      });
      expect(response.statusCode).toBe(200);
      expect(query).toHaveBeenCalledWith(expect.stringContaining("api-manual-order-requested"), [
        "operator-token",
        expect.stringMatching(/^manual_\d+_[a-f0-9]{12}$/),
        "BTCUSDT",
        "BUY",
        "MARKET",
        "0.0002",
        null,
        "small test buy"
      ]);
      expect(redis.sendCommand).toHaveBeenCalledWith([
        "XADD",
        "signals",
        "*",
        "kind",
        "signal",
        "signalId",
        expect.stringMatching(/^manual_\d+_[a-f0-9]{12}$/),
        "payload",
        expect.any(String)
      ]);
      const command = firstRedisCommand(redis.sendCommand);
      const signal = parseSignalPayload(command.at(-1) as string);
      expect(signal.strategyId).toBe("manual");
      expect(signal.intent).toMatchObject({
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        reason: "manual:small test buy"
      });
      expect(signal.intent.quantity.toFixed()).toBe("0.0002");
      expect(response.json()).toMatchObject({
        stream: "signals",
        streamId: "1791890000000-0",
        strategyId: "manual",
        status: "queued"
      });
    } finally {
      await server.close();
    }
  });

  it("queues a manual limit order with exact decimal strings", async () => {
    const { server, redis } = setup();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/orders/manual",
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: manualOrder({
          side: "SELL",
          type: "LIMIT",
          quantity: "0.00100001",
          limitPrice: "90000.12345678",
          reason: "manual limit exit"
        })
      });
      expect(response.statusCode).toBe(200);
      const command = firstRedisCommand(redis.sendCommand);
      const signal = parseSignalPayload(command.at(-1) as string);
      expect(signal.intent.quantity.toFixed()).toBe("0.00100001");
      expect(signal.intent.limitPrice?.toFixed()).toBe("90000.12345678");
    } finally {
      await server.close();
    }
  });

  it("rejects unsafe or incomplete manual orders before publishing", async () => {
    const { server, redis } = setup();
    try {
      for (const payload of [
        manualOrder({ confirm: "" }),
        manualOrder({ quantity: "0" }),
        manualOrder({ type: "LIMIT", limitPrice: "" }),
        manualOrder({ type: "MARKET", limitPrice: "85000" }),
        manualOrder({ symbol: "bad.symbol" })
      ]) {
        const response = await server.inject({
          method: "POST",
          url: "/api/orders/manual",
          headers: { authorization: `Bearer ${operatorToken}` },
          payload
        });
        expect(response.statusCode).toBe(400);
      }
      expect(redis.sendCommand).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("does not publish when audit persistence fails and sanitizes Redis failures", async () => {
    const failingDb = setup({ failDb: true });
    try {
      const response = await failingDb.server.inject({
        method: "POST",
        url: "/api/orders/manual",
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: manualOrder()
      });
      expect(response.statusCode).toBe(503);
      expect(failingDb.redis.sendCommand).not.toHaveBeenCalled();
      expect(response.body).not.toMatch(/database unavailable|postgres:\/\//);
    } finally {
      await failingDb.server.close();
    }

    const failingRedis = setup({ failRedis: true });
    try {
      const response = await failingRedis.server.inject({
        method: "POST",
        url: "/api/orders/manual",
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: manualOrder()
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        error: "manual_order_unavailable",
        message: "Manual order could not be queued"
      });
      expect(response.body).not.toMatch(/redis unavailable/);
    } finally {
      await failingRedis.server.close();
    }
  });
});

function manualOrder(
  override: Partial<{
    symbol: string;
    side: "BUY" | "SELL";
    type: "MARKET" | "LIMIT";
    quantity: string;
    limitPrice: string;
    reason: string;
    confirm: string;
  }> = {}
) {
  return {
    symbol: "BTCUSDT",
    side: "BUY",
    type: "MARKET",
    quantity: "0.0002",
    reason: "manual test order",
    confirm: "QUEUE_MANUAL_ORDER",
    ...override
  };
}

function firstRedisCommand(fn: unknown): readonly unknown[] {
  const command = (fn as { mock: { calls: readonly (readonly [readonly unknown[]])[] } }).mock
    .calls[0]?.[0];
  if (!command) throw new Error("Expected Redis XADD command");
  return command;
}
