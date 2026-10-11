import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

const count = z.number().int().nonnegative().safe();
export const systemHealthSchema = z.object({
  checkedAt: count,
  redis: z.enum(["available", "unavailable"]),
  database: z.enum(["available", "unavailable"]),
  streams: z
    .array(
      z.object({
        stream: z.string().max(100),
        status: z.enum(["available", "missing", "unavailable"]),
        length: count.nullable(),
        groups: z
          .array(
            z.object({
              name: z.string().max(100),
              consumers: count,
              pending: count,
              lag: count.nullable()
            })
          )
          .max(50)
      })
    )
    .max(7)
});
export type SystemHealth = z.infer<typeof systemHealthSchema>;
export type HealthReader = () => Promise<SystemHealth>;
const streams = [
  "market.trade.BTCUSDT",
  "market.book.BTCUSDT",
  ...["1m", "5m", "15m", "1h"].map((interval) => `market.kline.BTCUSDT.${interval}`),
  "signals"
];

export function parseGroups(value: unknown): SystemHealth["streams"][number]["groups"] {
  if (!Array.isArray(value) || value.length > 50) throw new Error("health_unavailable");
  return value.map((row) => {
    if (!Array.isArray(row) || row.length % 2) throw new Error("health_unavailable");
    const fields = new Map<string, unknown>();
    for (let i = 0; i < row.length; i += 2) fields.set(String(row[i]), row[i + 1]);
    return systemHealthSchema.shape.streams.element.shape.groups.element.parse({
      name: fields.get("name"),
      consumers: fields.get("consumers"),
      pending: fields.get("pending"),
      lag: fields.get("lag") ?? null
    });
  });
}

export function createSystemHealthReader(deps: {
  command: (args: string[]) => Promise<unknown>;
  database: () => Promise<unknown>;
  now?: () => number;
}): HealthReader {
  const now = deps.now ?? Date.now;
  let cached: SystemHealth | undefined;
  let pending: Promise<SystemHealth> | undefined;
  return () => {
    if (pending) return pending;
    if (cached && now() - cached.checkedAt < 5000) return Promise.resolve(cached);
    pending = (async () => {
      const [redis, database] = await Promise.all([
        deps
          .command(["PING"])
          .then(() => "available" as const)
          .catch(() => "unavailable" as const),
        deps
          .database()
          .then(() => "available" as const)
          .catch(() => "unavailable" as const)
      ]);
      const rows = await Promise.all(
        streams.map(async (stream): Promise<SystemHealth["streams"][number]> => {
          const unavailable = { stream, status: "unavailable" as const, length: null, groups: [] };
          if (redis === "unavailable") return unavailable;
          try {
            if ((await deps.command(["EXISTS", stream])) === 0)
              return { stream, status: "missing", length: null, groups: [] };
            const [length, groups] = await Promise.all([
              deps.command(["XLEN", stream]),
              deps.command(["XINFO", "GROUPS", stream])
            ]);
            return {
              stream,
              status: "available",
              length: count.parse(length),
              groups: parseGroups(groups)
            };
          } catch {
            return unavailable;
          }
        })
      );
      cached = systemHealthSchema.parse({ checkedAt: now(), redis, database, streams: rows });
      return cached;
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}

export function registerSystemHealth(server: FastifyInstance, health: HealthReader) {
  server.withTypeProvider<ZodTypeProvider>().get(
    "/api/system/health",
    {
      schema: { tags: ["System"], response: { 200: systemHealthSchema } }
    },
    async (_request, reply) => {
      reply.header("Cache-Control", "no-store");
      return health();
    }
  );
}
