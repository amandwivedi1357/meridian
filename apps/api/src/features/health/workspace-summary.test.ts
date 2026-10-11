import Fastify from "fastify";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { registerApiAuth } from "../../app/auth.js";
import { registerWorkspaceSummary, workspaceConfiguration } from "./workspace-summary.js";

describe("workspace read-only summaries", () => {
  it("allowlists configuration and never exports credentials or arbitrary env values", () => {
    const result = workspaceConfiguration({
      API_OPERATOR_TOKEN: "secret",
      DATABASE_URL: "secret",
      EXECUTOR_MAX_NOTIONAL: "25",
      EXECUTOR_MAX_QUANTITY: "invalid",
      BINANCE_ENV: "testnet"
    });
    expect(result.limits.MAX_NOTIONAL).toBe("25");
    expect(result.limits.MAX_QUANTITY).toBeNull();
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result.source).toContain("liveness not verified");
  });
  it("requires authentication and strips audit detail payloads", async () => {
    const app = Fastify();
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: "1",
            tsMs: "100",
            actor: "operator",
            action: "pause",
            details: { secret: "hidden" }
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [{ id: "001", appliedAt: new Date(100) }] });
    registerApiAuth(app, { viewerToken: "v".repeat(32) });
    registerWorkspaceSummary(app, { query } as unknown as Pool, {});
    try {
      expect((await app.inject({ url: "/api/system/workspace" })).statusCode).toBe(401);
      expect(query).not.toHaveBeenCalled();
      const response = await app.inject({
        url: "/api/system/workspace",
        headers: { authorization: `Bearer ${"v".repeat(32)}` }
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().audits[0].action).toBe("pause");
      expect(response.body).not.toContain("hidden");
      expect(response.json().migrations[0].id).toBe("001");
    } finally {
      await app.close();
    }
  });
  it("reports individual unavailable storage reads without exposing errors", async () => {
    const app = Fastify();
    registerWorkspaceSummary(
      app,
      { query: vi.fn().mockRejectedValue(new Error("private detail")) } as unknown as Pool,
      {}
    );
    try {
      const response = await app.inject({ url: "/api/system/workspace" });
      expect(response.json().audits).toBeNull();
      expect(response.json().migrations).toBeNull();
      expect(response.body).not.toContain("private");
    } finally {
      await app.close();
    }
  });
});
