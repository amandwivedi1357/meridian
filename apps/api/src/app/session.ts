import { randomBytes } from "node:crypto";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { authenticateRequest, currentPrincipal, type ApiAuthConfig } from "./auth.js";

export async function registerSessions(server: FastifyInstance, config: ApiAuthConfig) {
  await server.register(cookie);
  await server.register(jwt, {
    secret: config.jwtSecret ?? randomBytes(32).toString("hex"),
    cookie: { cookieName: "meridian_session", signed: false },
    sign: { algorithm: "HS256", iss: "meridian-api", aud: "meridian-dashboard", expiresIn: "15m" },
    verify: { algorithms: ["HS256"], allowedIss: "meridian-api", allowedAud: "meridian-dashboard" }
  });
  const app = server.withTypeProvider<ZodTypeProvider>();
  app.post(
    "/api/auth/login",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: {
        tags: ["Auth"],
        body: z.object({ token: z.string().min(32).max(4096) }).strict(),
        response: {
          200: z.object({ role: z.enum(["viewer", "operator"]), expiresAtMs: z.number() }),
          401: z.object({ error: z.string(), message: z.string() }),
          403: z.object({ error: z.string() }),
          503: z.object({ error: z.string() })
        }
      }
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (request.headers.origin && !config.allowedOrigins?.includes(request.headers.origin))
        return reply.code(403).send({ error: "invalid_origin" });
      if (!config.viewerToken && !config.operatorToken)
        return reply.code(503).send({ error: "login_not_configured" });
      const principal = authenticateRequest(
        { headers: { authorization: `Bearer ${request.body.token}` } } as Parameters<
          typeof authenticateRequest
        >[0],
        config
      );
      if (!principal)
        return reply.code(401).send({ error: "unauthorized", message: "Invalid API credential" });
      const signed = server.jwt.sign({ role: principal.role, sub: principal.actor });
      const { exp } = server.jwt.decode<{ exp: number }>(signed)!;
      reply.setCookie("meridian_session", signed, {
        path: "/api",
        httpOnly: true,
        sameSite: "strict",
        secure: config.production ?? false,
        maxAge: 900
      });
      return { role: principal.role, expiresAtMs: exp * 1000 };
    }
  );
  app.get("/api/auth/me", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return { principal: currentPrincipal(request) };
  });
  app.post("/api/auth/logout", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.clearCookie("meridian_session", {
      path: "/api",
      httpOnly: true,
      sameSite: "strict",
      secure: config.production ?? false
    });
    return { loggedOut: true };
  });
}
