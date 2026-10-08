import { createRedisStreamClient, type RedisStreamClient } from "@meridian/bus";
import { Pool } from "pg";
import { createClient } from "redis";

export interface EngineRuntimePostgresClient {
  readonly query: (query: {
    readonly text: string;
    readonly values: readonly unknown[];
  }) => Promise<{
    readonly rows: readonly unknown[];
  }>;
  readonly close: () => Promise<void>;
}

export interface EngineRuntimeRedisClient extends RedisStreamClient {
  readonly connect: () => Promise<void>;
  readonly close: () => Promise<void>;
}

export interface EngineRuntimeClients {
  readonly postgres: EngineRuntimePostgresClient;
  readonly redis: EngineRuntimeRedisClient;
  readonly close: () => Promise<void>;
}

export interface PostgresPoolLike {
  readonly query: (
    text: string,
    values?: readonly unknown[]
  ) => Promise<{
    readonly rows: readonly unknown[];
  }>;
  readonly end: () => Promise<void>;
}

export interface RedisCommandClientLike {
  readonly connect: () => Promise<unknown>;
  readonly quit: () => Promise<unknown>;
  readonly sendCommand: (args: readonly (string | Buffer)[]) => Promise<unknown>;
}

export interface EngineRuntimeClientFactoryDeps {
  readonly createPostgresPool: (connectionString: string) => PostgresPoolLike;
  readonly createRedisCommandClient: (url: string) => RedisCommandClientLike;
}

export interface EngineRuntimeClientConfig {
  readonly postgresUrl: string;
  readonly redisUrl: string;
}

export function createEngineRuntimeClients(
  config: EngineRuntimeClientConfig,
  deps: EngineRuntimeClientFactoryDeps = defaultEngineRuntimeClientFactoryDeps
): EngineRuntimeClients {
  const postgresPool = deps.createPostgresPool(config.postgresUrl);
  const postgres: EngineRuntimePostgresClient = {
    async query(query) {
      return postgresPool.query(query.text, query.values);
    },
    close() {
      return postgresPool.end();
    }
  };

  const redisCommandClient = deps.createRedisCommandClient(config.redisUrl);
  const streamClient = createRedisStreamClient(redisCommandClient);
  let redisConnected = false;

  const redis: EngineRuntimeRedisClient = {
    ...streamClient,

    async connect() {
      await redisCommandClient.connect();
      redisConnected = true;
    },

    async close() {
      if (!redisConnected) return;

      redisConnected = false;
      await redisCommandClient.quit();
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

const defaultEngineRuntimeClientFactoryDeps: EngineRuntimeClientFactoryDeps = {
  createPostgresPool(connectionString) {
    return new Pool({ connectionString });
  },

  createRedisCommandClient(url) {
    const client = createClient({ url });

    return {
      connect() {
        return client.connect();
      },

      quit() {
        return client.quit();
      },

      sendCommand(args) {
        return client.sendCommand([...args]);
      }
    };
  }
};
