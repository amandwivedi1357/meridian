import Fastify from "fastify";
import { Pool } from "pg";
import { createClient } from "redis";
import { fileURLToPath } from "node:url";
import { registerDashboard } from "./dashboard.js";

const server = Fastify({ logger: true });
const redis = createClient({
  url: process.env.REDIS_URL ?? "redis://localhost:6379",
  socket: { connectTimeout: 2000 },
  disableOfflineQueue: true
});
redis.on("error", (error) =>
  server.log.warn({ err: error }, "Dashboard Redis connection unavailable")
);
void redis.connect().catch((error) => server.log.warn({ err: error }, "Redis startup failed"));
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://meridian:meridian@localhost:5432/meridian",
  max: 2,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000
});
pool.on("error", (error) =>
  server.log.warn({ err: error }, "Dashboard database connection unavailable")
);
registerDashboard(server, redis, pool, fileURLToPath(new URL("../../../", import.meta.url)));
server.addHook("onClose", async () => {
  if (redis.isOpen) redis.destroy();
  await pool.end();
});

server.get("/health/live", async () => ({ status: "ok" }));
server.get("/health/ready", async () => ({ status: "ok" }));

const port = Number(process.env.API_PORT ?? 3000);

await server.listen({ host: "127.0.0.1", port });
