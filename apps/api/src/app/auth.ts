import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export type ApiRole = "viewer" | "operator";

export interface ApiAuthConfig {
  readonly viewerToken?: string;
  readonly operatorToken?: string;
  readonly jwtSecret?: string;
  readonly production?: boolean;
  readonly allowedOrigins?: readonly string[];
}

export interface ApiPrincipal {
  readonly role: ApiRole;
  readonly actor: string;
  readonly expiresAtMs?: number;
}

const principals = new WeakMap<FastifyRequest, ApiPrincipal>();

export function loadApiAuthConfig(env: Record<string, string | undefined>): ApiAuthConfig {
  const viewerToken = readToken(env["API_VIEWER_TOKEN"], "API_VIEWER_TOKEN");
  const operatorToken = readToken(env["API_OPERATOR_TOKEN"], "API_OPERATOR_TOKEN");
  const production = env.NODE_ENV === "production";
  if (viewerToken && viewerToken === operatorToken)
    throw new Error("Viewer and operator credentials must differ");
  const jwtSecret = env.JWT_SECRET;
  if (
    (production || viewerToken || operatorToken) &&
    (!jwtSecret || jwtSecret.length < 32 || jwtSecret.startsWith("change-me"))
  ) {
    throw new Error(
      "JWT_SECRET must be a private secret of at least 32 characters for authenticated API mode"
    );
  }
  if (production && !viewerToken && !operatorToken)
    throw new Error("Production API credentials required");

  const allowedOrigins = (env.API_ALLOWED_ORIGINS ?? "http://127.0.0.1:5173,http://127.0.0.1:3000")
    .split(",")
    .map((origin) => new URL(origin.trim()).origin);
  if (
    production &&
    (!env.API_ALLOWED_ORIGINS || allowedOrigins.some((origin) => !origin.startsWith("https://")))
  )
    throw new Error("Production API requires explicit HTTPS origins");
  return {
    ...(viewerToken === undefined ? {} : { viewerToken }),
    ...(operatorToken === undefined ? {} : { operatorToken }),
    ...(jwtSecret && jwtSecret.length >= 32 ? { jwtSecret } : {}),
    production,
    allowedOrigins
  };
}

export function registerApiAuth(server: FastifyInstance, config: ApiAuthConfig): void {
  server.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    if (request.url.split("?")[0] === "/api/auth/login") return;

    let principal = authenticateRequest(request, config);
    if (principal === null && server.hasDecorator("jwt")) {
      try {
        const token =
          readRequestToken(request) ??
          server.parseCookie(request.headers.cookie ?? "").meridian_session;
        if (!token) throw new Error("Missing session");
        const payload = server.jwt.verify<{ role: ApiRole; sub: string; exp: number }>(token);
        if (
          (payload.role === "viewer" || payload.role === "operator") &&
          typeof payload.sub === "string" &&
          typeof payload.exp === "number" &&
          Number.isSafeInteger(payload.exp)
        ) {
          principal = { role: payload.role, actor: payload.sub, expiresAtMs: payload.exp * 1000 };
        }
      } catch {
        /* Invalid or expired sessions never authorize a request. */
      }
    }
    if (principal === null) {
      return reply.code(401).send({
        error: "unauthorized",
        message: "API token is required"
      });
    }

    if (
      !readRequestToken(request) &&
      request.headers.cookie &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      !config.allowedOrigins?.includes(request.headers.origin ?? "")
    ) {
      return reply
        .code(403)
        .send({ error: "invalid_origin", message: "Session writes require an allowed Origin" });
    }

    principals.set(request, principal);
  });
}

export function requireOperator() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const principal = principals.get(request);
    if (principal?.role === "operator") return;

    return reply.code(403).send({
      error: "forbidden",
      message: "Operator role is required"
    });
  };
}

export function currentPrincipal(request: FastifyRequest): ApiPrincipal | null {
  return principals.get(request) ?? null;
}

export function authenticateRequest(
  request: FastifyRequest,
  config: ApiAuthConfig
): ApiPrincipal | null {
  const configured = config.viewerToken !== undefined || config.operatorToken !== undefined;
  if (!configured) return { role: "viewer", actor: "local-dev" };

  const token = readRequestToken(request);
  if (token === null) return null;

  if (config.operatorToken !== undefined && tokenEquals(token, config.operatorToken)) {
    return { role: "operator", actor: "operator-token" };
  }
  if (config.viewerToken !== undefined && tokenEquals(token, config.viewerToken)) {
    return { role: "viewer", actor: "viewer-token" };
  }

  return null;
}

function readRequestToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (typeof authorization === "string") {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match?.[1] !== undefined && match[1].trim() !== "") return match[1].trim();
  }

  const header = request.headers["x-meridian-api-token"];
  if (typeof header === "string" && header.trim() !== "") return header.trim();

  return null;
}

function readToken(value: string | undefined, name: string): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const token = value.trim();
  if (token.length < 32) {
    throw new Error(`${name} must be at least 32 characters when configured`);
  }
  return token;
}

function tokenEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
