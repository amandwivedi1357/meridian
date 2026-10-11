import swagger from "@fastify/swagger";
import rateLimit from "@fastify/rate-limit";
import { Redis } from "ioredis";
import type { FastifyInstance } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler
} from "fastify-type-provider-zod";
import { z } from "zod";
import { registerResponseContracts } from "./response-contracts.js";

export async function configureGateway(
  server: FastifyInstance,
  redisUrl: string,
  options: { namespace?: string; maxRequests?: number } = {}
) {
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  registerResponseContracts(server);
  await server.register(swagger, {
    openapi: {
      info: { title: "Meridian API", version: "0.1.0" },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT or API key" },
          sessionAuth: { type: "apiKey", in: "cookie", name: "meridian_session" }
        }
      }
    },
    transform: jsonSchemaTransform
  });
  const limiter = new Redis(redisUrl, {
    connectTimeout: 2000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true
  });
  limiter.on("error", () => server.log.warn("API rate-limit Redis unavailable"));
  await limiter.connect();
  server.addHook("onClose", async () => {
    limiter.disconnect();
  });
  await server.register(rateLimit, {
    redis: limiter,
    nameSpace: options.namespace ?? "meridian:api:rate:",
    max: options.maxRequests ?? 300,
    timeWindow: "1 minute",
    skipOnError: false,
    allowList: (request) => request.url.startsWith("/health/"),
    keyGenerator: (request) => request.ip
  });
  server.addHook("onRoute", (route) => {
    if (!route.url.startsWith("/api/")) return;
    route.schema ??= {};
    route.schema.security ??=
      route.url === "/api/auth/login" ? [] : [{ bearerAuth: [] }, { sessionAuth: [] }];
    route.schema.tags ??= [route.url.split("/")[2] ?? "API"];
    if (!route.schema.querystring)
      route.schema.querystring =
        route.url === "/api/market/candles"
          ? z
              .object({
                symbol: z
                  .string()
                  .regex(/^[A-Z0-9]{2,30}$/)
                  .optional(),
                interval: z.enum(["1m", "5m", "15m", "1h"]).optional(),
                limit: z
                  .string()
                  .regex(/^\d{1,4}$/)
                  .optional()
              })
              .strict()
          : /^\/api\/(orders|fills|risk\/events|trading\/state)$/.test(route.url)
            ? z
                .object({
                  limit: z
                    .string()
                    .regex(/^\d{1,4}$/)
                    .optional()
                })
                .strict()
            : z.object({}).strict();
    if (route.url.includes(":strategyId"))
      route.schema.params ??= z
        .object({ strategyId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) })
        .strict();
    if (route.url.endsWith("/pause") || route.url.endsWith("/engage"))
      route.schema.body ??= z.object({ reason: z.string().trim().min(1).max(500) }).strict();
    if (route.url.endsWith("/resume"))
      route.schema.body ??= z
        .object({
          reason: z.string().trim().min(1).max(500),
          confirm: z.literal("RESUME_STRATEGY")
        })
        .strict();
  });
  server.get("/api/openapi.json", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return server.swagger();
  });
}
