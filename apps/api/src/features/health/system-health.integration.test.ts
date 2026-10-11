import { Redis } from "ioredis";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createSystemHealthReader } from "./system-health.js";

it.skipIf(!process.env.API_TEST_REDIS_URL || !process.env.API_TEST_DATABASE_URL)(
  "reads actual consumer pending and undelivered lag from isolated Redis streams",
  async () => {
    const redis = new Redis(process.env.API_TEST_REDIS_URL!, {
      connectTimeout: 2000,
      commandTimeout: 2000,
      maxRetriesPerRequest: 1
    });
    const pool = new Pool({
      connectionString: process.env.API_TEST_DATABASE_URL,
      connectionTimeoutMillis: 2000
    });
    const prefix = `test:system-health:${randomUUID()}:`;
    const key = `${prefix}market.trade.BTCUSDT`;
    try {
      await redis.xadd(key, "*", "payload", "one");
      await redis.xgroup("CREATE", key, "test-engine", "0");
      await redis.xreadgroup(
        "GROUP",
        "test-engine",
        "test-consumer",
        "COUNT",
        1,
        "STREAMS",
        key,
        ">"
      );
      await redis.xadd(key, "*", "payload", "two");
      const read = createSystemHealthReader({
        command: (args) => {
          const scoped = [...args];
          const keyIndex = args[0] === "XINFO" ? 2 : 1;
          if (args[0] !== "PING") scoped[keyIndex] = prefix + scoped[keyIndex];
          return redis.call(scoped[0]!, ...scoped.slice(1));
        },
        database: () => pool.query("SELECT 1")
      });
      const health = await read();
      expect(health.redis).toBe("available");
      expect(health.database).toBe("available");
      expect(health.streams[0]).toMatchObject({
        status: "available",
        length: 2,
        groups: [{ name: "test-engine", consumers: 1, pending: 1, lag: 1 }]
      });
      expect(health.streams[1]?.status).toBe("missing");
    } finally {
      await redis.del(key);
      redis.disconnect();
      await pool.end();
    }
  }
);
