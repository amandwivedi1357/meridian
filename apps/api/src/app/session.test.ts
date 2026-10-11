import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { describe, expect, it } from "vitest";
import { registerApiAuth, requireOperator, loadApiAuthConfig } from "./auth.js";
import { registerSessions } from "./session.js";

const viewerToken = "v".repeat(40),
  operatorToken = "o".repeat(40);
const config = {
  viewerToken,
  operatorToken,
  jwtSecret: "s".repeat(40),
  allowedOrigins: ["http://127.0.0.1:5173"]
};
async function fixture() {
  const server = Fastify();
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  registerApiAuth(server, config);
  await registerSessions(server, config);
  server.post("/api/operator", { preHandler: requireOperator() }, async () => ({ ok: true }));
  return server;
}
describe("JWT sessions", () => {
  it("creates short-lived HttpOnly viewer sessions and enforces roles/origins", async () => {
    const server = await fixture();
    try {
      const login = await server.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { token: viewerToken }
      });
      expect(login.statusCode).toBe(200);
      expect(login.json().role).toBe("viewer");
      expect(login.headers["set-cookie"]).toContain("HttpOnly");
      expect(login.headers["set-cookie"]).toContain("SameSite=Strict");
      const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
      const me = await server.inject({ url: "/api/auth/me", headers: { cookie } });
      expect(me.statusCode).toBe(200);
      expect(me.json().principal.role).toBe("viewer");
      expect(me.json().principal.expiresAtMs - Date.now()).toBeLessThanOrEqual(900000);
      expect(
        (
          await server.inject({
            method: "POST",
            url: "/api/operator",
            headers: { cookie, origin: config.allowedOrigins[0]! }
          })
        ).statusCode
      ).toBe(403);
      const operator = await server.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { token: operatorToken }
      });
      const opCookie = String(operator.headers["set-cookie"]).split(";")[0]!;
      expect(
        (
          await server.inject({
            method: "POST",
            url: "/api/operator",
            headers: { cookie: opCookie }
          })
        ).statusCode
      ).toBe(403);
      expect(
        (
          await server.inject({
            method: "POST",
            url: "/api/operator",
            headers: { cookie: opCookie, origin: "https://evil.example" }
          })
        ).statusCode
      ).toBe(403);
      expect(
        (
          await server.inject({
            method: "POST",
            url: "/api/operator",
            headers: { cookie: opCookie, origin: config.allowedOrigins[0]! }
          })
        ).statusCode
      ).toBe(200);
      const logout = await server.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: { cookie: opCookie, origin: config.allowedOrigins[0]! }
      });
      expect(logout.headers["set-cookie"]).toContain("Expires=Thu, 01 Jan 1970");
    } finally {
      await server.close();
    }
  });
  it("rejects tampered, expired, wrong-audience and wrong-role JWTs", async () => {
    const server = await fixture();
    try {
      const invalid = [
        server.jwt.sign({ role: "operator", sub: "test" }) + "x",
        server.jwt.sign({ role: "operator", sub: "test", exp: 1 }),
        server.jwt.sign({ role: "operator", sub: "test" }, { aud: "wrong" }),
        server.jwt.sign({ role: "admin", sub: "test" }),
        server.jwt.sign({ role: "viewer", sub: "test" }, { iss: "wrong" })
      ];
      for (const token of invalid)
        expect(
          (
            await server.inject({
              url: "/api/auth/me",
              headers: { authorization: `Bearer ${token}` }
            })
          ).statusCode
        ).toBe(401);
      expect(
        (
          await server.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { token: "bad".repeat(15), role: "operator" }
          })
        ).statusCode
      ).toBe(400);
      expect(
        (
          await server.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { token: "bad".repeat(15) }
          })
        ).statusCode
      ).toBe(401);
    } finally {
      await server.close();
    }
  });
  it("does not allow unconfigured login or insecure authenticated production config", async () => {
    expect(() => loadApiAuthConfig({ NODE_ENV: "production", JWT_SECRET: "s".repeat(40) })).toThrow(
      "credentials"
    );
    expect(() =>
      loadApiAuthConfig({ API_VIEWER_TOKEN: viewerToken, JWT_SECRET: "change-me-in-local-env" })
    ).toThrow("JWT_SECRET");
    const server = Fastify();
    server.setValidatorCompiler(validatorCompiler);
    server.setSerializerCompiler(serializerCompiler);
    registerApiAuth(server, {});
    await registerSessions(server, {});
    try {
      expect(
        (
          await server.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { token: operatorToken }
          })
        ).statusCode
      ).toBe(503);
    } finally {
      await server.close();
    }
  });
});
