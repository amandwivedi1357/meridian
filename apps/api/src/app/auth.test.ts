import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  currentPrincipal,
  loadApiAuthConfig,
  registerApiAuth,
  requireOperator
} from "./auth.js";

const viewerToken = "viewer-token-12345678901234567890";
const operatorToken = "operator-token-123456789012345678";

describe("API auth", () => {
  it("allows local read APIs without tokens configured", async () => {
    const server = Fastify();
    registerApiAuth(server, {});
    server.get("/api/example", async (request) => ({ principal: currentPrincipal(request) }));

    try {
      const response = await server.inject({ method: "GET", url: "/api/example" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        principal: { role: "viewer", actor: "local-dev" }
      });
    } finally {
      await server.close();
    }
  });

  it("requires a configured token for API routes and accepts viewer bearer tokens", async () => {
    const server = Fastify();
    registerApiAuth(server, { viewerToken, operatorToken });
    server.get("/api/example", async (request) => ({ principal: currentPrincipal(request) }));

    try {
      const missing = await server.inject({ method: "GET", url: "/api/example" });
      expect(missing.statusCode).toBe(401);
      expect(missing.json()).toEqual({
        error: "unauthorized",
        message: "API token is required"
      });

      const response = await server.inject({
        method: "GET",
        url: "/api/example",
        headers: { authorization: `Bearer ${viewerToken}` }
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        principal: { role: "viewer", actor: "viewer-token" }
      });
    } finally {
      await server.close();
    }
  });

  it("accepts operator tokens and blocks viewer tokens from operator handlers", async () => {
    const server = Fastify();
    registerApiAuth(server, { viewerToken, operatorToken });
    server.post("/api/operator", { preHandler: requireOperator() }, async (request) => ({
      principal: currentPrincipal(request)
    }));

    try {
      const viewer = await server.inject({
        method: "POST",
        url: "/api/operator",
        headers: { "x-meridian-api-token": viewerToken }
      });
      expect(viewer.statusCode).toBe(403);

      const operator = await server.inject({
        method: "POST",
        url: "/api/operator",
        headers: { "x-meridian-api-token": operatorToken }
      });
      expect(operator.statusCode).toBe(200);
      expect(operator.json()).toEqual({
        principal: { role: "operator", actor: "operator-token" }
      });
    } finally {
      await server.close();
    }
  });

  it("does not require auth for health routes", async () => {
    const server = Fastify();
    registerApiAuth(server, { viewerToken });
    server.get("/health/live", async () => ({ status: "ok" }));

    try {
      const response = await server.inject({ method: "GET", url: "/health/live" });
      expect(response.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("rejects configured short tokens at startup", () => {
    expect(() =>
      loadApiAuthConfig({
        API_VIEWER_TOKEN: "short",
        API_OPERATOR_TOKEN: undefined
      })
    ).toThrow("API_VIEWER_TOKEN must be at least 32 characters");
  });
});
