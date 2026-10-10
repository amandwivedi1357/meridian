import Fastify from "fastify";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { registerApiAuth } from "../../app/auth.js";
import { registerStrategyControlRoutes } from "./strategy-control.js";

const viewerToken = "viewer-token-12345678901234567890";
const operatorToken = "operator-token-123456789012345678";

describe("strategy control write API", () => {
  function setup(options: { failDb?: boolean } = {}) {
    const server = Fastify();
    registerApiAuth(server, { viewerToken, operatorToken });
    const query = vi.fn(async (sql: string) => {
      if (options.failDb) throw new Error("database unavailable");
      const paused = !sql.includes("api-strategy-resumed");
      return {
        rows: [
          {
            strategy_id: "ema-live",
            paused,
            reason: paused ? "pause for inspection" : "resume after inspection",
            updated_at_ms: "1791622376000"
          }
        ]
      };
    });
    registerStrategyControlRoutes(server, { query } as unknown as Pool);
    return { server, query };
  }

  it("requires an operator token", async () => {
    const { server } = setup();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/strategies/ema-live/pause",
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: { reason: "pause for inspection" }
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("pauses a strategy durably with audit evidence", async () => {
    const { server, query } = setup();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/strategies/ema-live/pause",
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: { reason: " pause for inspection " }
      });

      expect(response.statusCode).toBe(200);
      expect(query).toHaveBeenCalledWith(expect.stringContaining("api-strategy-paused"), [
        "ema-live",
        "pause for inspection",
        "operator-token"
      ]);
      expect(response.json()).toMatchObject({
        strategy: {
          strategyId: "ema-live",
          paused: true,
          reason: "pause for inspection",
          updatedAtMs: 1_791_622_376_000
        }
      });
    } finally {
      await server.close();
    }
  });

  it("validates strategy id and reason", async () => {
    const { server } = setup();
    try {
      const badId = await server.inject({
        method: "POST",
        url: "/api/strategies/bad.id/pause",
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: { reason: "pause" }
      });
      expect(badId.statusCode).toBe(400);

      const badReason = await server.inject({
        method: "POST",
        url: "/api/strategies/ema-live/pause",
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: { reason: "" }
      });
      expect(badReason.statusCode).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("sanitizes persistence failures", async () => {
    const { server } = setup({ failDb: true });
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/strategies/ema-live/pause",
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: { reason: "pause for inspection" }
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        error: "strategy_pause_unavailable",
        message: "Strategy could not be paused"
      });
      expect(response.body).not.toMatch(/database unavailable|postgres:\/\//);
    } finally {
      await server.close();
    }
  });

  it("requires explicit confirmation before resuming a strategy", async () => {
    const { server } = setup();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/strategies/ema-live/resume",
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: { reason: "resume after inspection" }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: "missing_resume_confirmation",
        message: "Strategy resume requires explicit confirmation"
      });
    } finally {
      await server.close();
    }
  });

  it("resumes a strategy durably with audit evidence", async () => {
    const { server, query } = setup();
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/strategies/ema-live/resume",
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: {
          reason: " resume after inspection ",
          confirm: "RESUME_STRATEGY"
        }
      });

      expect(response.statusCode).toBe(200);
      expect(query).toHaveBeenCalledWith(expect.stringContaining("api-strategy-resumed"), [
        "ema-live",
        "resume after inspection",
        "operator-token"
      ]);
      expect(response.json()).toMatchObject({
        strategy: {
          strategyId: "ema-live",
          paused: false,
          reason: "resume after inspection",
          updatedAtMs: 1_791_622_376_000
        }
      });
    } finally {
      await server.close();
    }
  });
});
