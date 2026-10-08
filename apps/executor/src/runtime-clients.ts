import { createRedisStreamClient, type RedisStreamClient } from "@meridian/bus";
import type { OrderWriteAheadRepositoryDeps, SqlQuery } from "@meridian/db";
import { Pool } from "pg";
import { createClient } from "redis";

export interface ExecutorRuntimePostgresClient extends OrderWriteAheadRepositoryDeps {
  readonly close: () => Promise<void>;
}

export interface ExecutorRuntimeRedisClient extends RedisStreamClient {
  readonly connect: () => Promise<void>;
  readonly close: () => Promise<void>;
}

export interface ExecutorRuntimeClients {
  readonly postgres: ExecutorRuntimePostgresClient;
  readonly redis: ExecutorRuntimeRedisClient;
  readonly close: () => Promise<void>;
}

export interface PostgresPoolLike {
  readonly query: (
    text: string,
    values?: readonly unknown[]
  ) => Promise<{
    readonly rowCount?: number | null;
    readonly rows: readonly Record<string, unknown>[];
  }>;
  readonly end: () => Promise<void>;
}

export interface RedisCommandClientLike {
  readonly connect: () => Promise<unknown>;
  readonly quit: () => Promise<unknown>;
  readonly sendCommand: (args: readonly (string | Buffer)[]) => Promise<unknown>;
}

export interface ExecutorRuntimeClientFactoryDeps {
  readonly createPostgresPool: (connectionString: string) => PostgresPoolLike;
  readonly createRedisCommandClient: (url: string) => RedisCommandClientLike;
}

export interface ExecutorRuntimeClientConfig {
  readonly postgresUrl: string;
  readonly redisUrl: string;
}

export function createExecutorRuntimeClients(
  config: ExecutorRuntimeClientConfig,
  deps: ExecutorRuntimeClientFactoryDeps = defaultExecutorRuntimeClientFactoryDeps
): ExecutorRuntimeClients {
  const postgresPool = deps.createPostgresPool(config.postgresUrl);
  const postgres: ExecutorRuntimePostgresClient = {
    async execute(query: SqlQuery) {
      const result = await postgresPool.query(query.text, query.values);

      return {
        rowCount: result.rowCount ?? result.rows.length,
        rows: result.rows
      };
    },
    close() {
      return postgresPool.end();
    }
  };

  const redisCommandClient = deps.createRedisCommandClient(config.redisUrl);
  const streamClient = createRedisStreamClient(redisCommandClient);
  let redisConnected = false;

  const redis: ExecutorRuntimeRedisClient = {
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

const defaultExecutorRuntimeClientFactoryDeps: ExecutorRuntimeClientFactoryDeps = {
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
