import type { PostgresLikeClient, PostgresQueryResult } from "@meridian/db";
import { Pool } from "pg";
import { createClient } from "redis";
import type {
  RedisStreamFields,
  RedisXaddClient
} from "../adapters/redis-stream-adapter.js";
import type { IngestorConfig } from "./config.js";

export interface RuntimePostgresClient extends PostgresLikeClient {
  readonly close: () => Promise<void>;
}

export interface RuntimeRedisClient extends RedisXaddClient {
  readonly connect: () => Promise<void>;
  readonly close: () => Promise<void>;
}

export interface RuntimeClients {
  readonly postgres: RuntimePostgresClient;
  readonly redis: RuntimeRedisClient;
  readonly close: () => Promise<void>;
}

export interface PostgresPoolLike {
  readonly query: (
    text: string,
    values?: readonly unknown[]
  ) => Promise<PostgresQueryResult>;
  readonly end: () => Promise<void>;
}

export interface RedisCommandClientLike {
  readonly connect: () => Promise<unknown>;
  readonly quit: () => Promise<unknown>;
  readonly sendCommand: (
    args: readonly (string | Buffer)[]
  ) => Promise<unknown>;
}

export interface RuntimeClientFactoryDeps {
  readonly createPostgresPool: (connectionString: string) => PostgresPoolLike;
  readonly createRedisCommandClient: (url: string) => RedisCommandClientLike;
}

export function createRuntimeClients(
  config: IngestorConfig,
  deps: RuntimeClientFactoryDeps = defaultRuntimeClientFactoryDeps
): RuntimeClients {
  const postgresPool = deps.createPostgresPool(config.postgresUrl);
  const postgres: RuntimePostgresClient = {
    query(text, values) {
      return postgresPool.query(text, values);
    },
    close() {
      return postgresPool.end();
    }
  };

  const redisCommandClient = deps.createRedisCommandClient(config.redisUrl);
  let redisConnected = false;

  const redis: RuntimeRedisClient = {
    async connect() {
      await redisCommandClient.connect();
      redisConnected = true;
    },

    async close() {
      if (!redisConnected) {
        return;
      }

      redisConnected = false;
      await redisCommandClient.quit();
    },

    async xAdd(stream, id, fields) {
      const reply = await redisCommandClient.sendCommand(
        buildXaddCommand(stream, id, fields)
      );

      if (typeof reply !== "string") {
        throw new Error("Redis XADD did not return a stream entry id");
      }

      return reply;
    }
  };

  return {
    postgres,
    redis,
    async close() {
      await Promise.all([redis.close(), postgres.close()]);
    }
  };
}

function buildXaddCommand(
  stream: string,
  id: "*",
  fields: RedisStreamFields
): readonly (string | Buffer)[] {
  const command: (string | Buffer)[] = ["XADD", stream, id];

  for (const [field, value] of Object.entries(fields)) {
    command.push(field, value);
  }

  return command;
}

const defaultRuntimeClientFactoryDeps: RuntimeClientFactoryDeps = {
  createPostgresPool(connectionString) {
    return new Pool({ connectionString });
  },

  createRedisCommandClient(url) {
    const client = createClient({ url });

    return {
      async connect() {
        await client.connect();
      },

      async quit() {
        await client.quit();
      },

      async sendCommand(args) {
        return client.sendCommand([...args]);
      }
    };
  }
};
