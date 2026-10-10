import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export type ApiRole = "viewer" | "operator";

export interface ApiAuthConfig {
  readonly viewerToken?: string;
  readonly operatorToken?: string;
}

export interface ApiPrincipal {
  readonly role: ApiRole;
  readonly actor: string;
}

const principals = new WeakMap<FastifyRequest, ApiPrincipal>();

export function loadApiAuthConfig(
  env: Record<string, string | undefined>
): ApiAuthConfig {
  const viewerToken = readToken(env["API_VIEWER_TOKEN"], "API_VIEWER_TOKEN");
  const operatorToken = readToken(env["API_OPERATOR_TOKEN"], "API_OPERATOR_TOKEN");

  return {
    ...(viewerToken === undefined ? {} : { viewerToken }),
    ...(operatorToken === undefined ? {} : { operatorToken })
  };
}

export function registerApiAuth(server: FastifyInstance, config: ApiAuthConfig): void {
  server.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;

    const principal = authenticateRequest(request, config);
    if (principal === null) {
      return reply.code(401).send({
        error: "unauthorized",
        message: "API token is required"
      });
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

function authenticateRequest(
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
