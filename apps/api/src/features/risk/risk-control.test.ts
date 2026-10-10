import Fastify from "fastify";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { registerApiAuth } from "../../app/auth.js";
import { registerRiskControlRoutes } from "./risk-control.js";

const viewerToken = "viewer-token-12345678901234567890";
const operatorToken = "operator-token-123456789012345678";

describe("risk control write API", () => {
  function setup(options: { failDb?: boolean; failRedis?: boolean } = {}) {
    const server = Fastify();
    registerApiAuth(server, { viewerToken, operatorToken });
    const query = vi.fn(async () => {
      if (options.failDb) throw new Error("database unavailable");
      return {
        rows: [
          {
            scope: "global",
            engaged: true,
            reason: "manual emergency stop",
            updated_at_ms: "1791622376000"
          }
        ]
      };
    });
    const redis = {
      sendCommand: vi.fn(async () => {
        if (options.failRedis) throw new Error("redis unavailable");
        return "OK";
      })
    };
    registerRiskControlRoutes(server, { query } as unknown as Pool, redis);
    return { server, query, redis };
  }

  it("requires an operator token", async () => {
    const { server } = setup();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/risk/kill-switch/engage",
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: { reason: "manual emergency stop" }
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("engages the kill switch durably and sets the Redis flag", async () => {
    const { server, query, redis } = setup();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/risk/kill-switch/engage",
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: { reason: " manual emergency stop " }
      });

      expect(response.statusCode).toBe(200);
      expect(query).toHaveBeenCalledWith(expect.stringContaining("api-kill-switch-engaged"), [
        "manual emergency stop",
        "operator-token"
      ]);
      expect(redis.sendCommand).toHaveBeenCalledWith(["SET", "meridian:risk:kill-switch", "1"]);
      expect(response.json()).toMatchObject({
        redisUpdated: true,
        riskControl: {
          scope: "global",
          engaged: true,
          reason: "manual emergency stop",
          updatedAtMs: 1_791_622_376_000
        }
      });
    } finally {
      await server.close();
    }
  });

  it("returns success when the DB is engaged but Redis flag update fails", async () => {
    const { server } = setup({ failRedis: true });
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/risk/kill-switch/engage",
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: { reason: "manual emergency stop" }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        redisUpdated: false,
        riskControl: { engaged: true }
      });
    } finally {
      await server.close();
    }
  });

  it("validates the reason and sanitizes persistence failures", async () => {
    const invalid = setup();
    try {
      const response = await invalid.server.inject({
        method: "POST",
        url: "/api/risk/kill-switch/engage",
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: { reason: " " }
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await invalid.server.close();
    }

    const failing = setup({ failDb: true });
    try {
      const response = await failing.server.inject({
        method: "POST",
        url: "/api/risk/kill-switch/engage",
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: { reason: "manual emergency stop" }
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        error: "kill_switch_engage_unavailable",
        message: "Kill switch could not be engaged"
      });
      expect(response.body).not.toMatch(/database unavailable|postgres:\/\//);
    } finally {
      await failing.server.close();
    }
  });
});
