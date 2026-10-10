import { createRedisStreamClient, type RedisStreamClient } from "@meridian/bus";
import type { OrderWriteAheadRepositoryDeps, RiskSqlDatabase, SqlQuery } from "@meridian/db";
import { Pool } from "pg";
import { createClient } from "redis";

export interface ExecutorRuntimePostgresClient extends RiskSqlDatabase {
  readonly close: () => Promise<void>;
}

export interface ExecutorRuntimeRedisClient extends RedisStreamClient {
  readonly command: (args: readonly (string | Buffer)[]) => Promise<unknown>;
  readonly connect: () => Promise<void>;
  readonly close: () => Promise<void>;
}

export interface ExecutorRuntimeClients {
  readonly postgres: ExecutorRuntimePostgresClient;
  readonly redis: ExecutorRuntimeRedisClient;
  readonly close: () => Promise<void>;
}

export interface PostgresPoolLike {
  readonly connect?: () => Promise<{
    query: PostgresPoolLike["query"];
    release: () => void;
  }>;
  readonly query: (
    text: string,
    values?: readonly unknown[]
  ) => Promise<
    | {
      readonly rowCount?: number | null;
      readonly rows: readonly Record<string, unknown>[];
    }
    | readonly {
        readonly rowCount?: number | null;
        readonly rows: readonly Record<string, unknown>[];
      }[]
  >;
  readonly end: () => Promise<void>;
}

export interface RedisCommandClientLike {
  readonly isReady?: () => boolean;
  readonly disconnect?: () => void;
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
    async transaction<T>(work: (db: OrderWriteAheadRepositoryDeps) => Promise<T>): Promise<T> {
      if (postgresPool.connect === undefined) throw new Error("Transaction connection unavailable");
      const client = await postgresPool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout = '2s'");
        await client.query("SET LOCAL statement_timeout = '5s'");
        const result = await work({
          async execute(query) {
            const response = lastPostgresResult(await client.query(query.text, query.values));
            return { rowCount: response.rowCount ?? null, rows: response.rows };
          }
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async execute(query: SqlQuery) {
      const result = lastPostgresResult(await postgresPool.query(query.text, query.values));

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
    command: (args) => redisCommandClient.sendCommand(args),

    async connect() {
      if (redisConnected && (redisCommandClient.isReady?.() ?? true)) return;
      await redisCommandClient.connect();
      redisConnected = true;
    },

    async close() {
      if (redisCommandClient.disconnect !== undefined) {
        redisConnected = false;
        redisCommandClient.disconnect();
        return;
      }
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

function lastPostgresResult(
  result:
    | {
        readonly rowCount?: number | null;
        readonly rows: readonly Record<string, unknown>[];
      }
    | readonly {
        readonly rowCount?: number | null;
        readonly rows: readonly Record<string, unknown>[];
      }[]
) {
  if (!Array.isArray(result)) return result;
  const last = result.at(-1);
  if (last === undefined) throw new Error("Postgres query returned no result");
  return last;
}

const defaultExecutorRuntimeClientFactoryDeps: ExecutorRuntimeClientFactoryDeps = {
  createPostgresPool(connectionString) {
    return new Pool({ connectionString, connectionTimeoutMillis: 2_000, query_timeout: 5_000 });
  },

  createRedisCommandClient(url) {
    const client = createClient({
      url,
      socket: { connectTimeout: 1_000, reconnectStrategy: false }
    });
    // Operations report errors to their callers; an EventEmitter error must not crash cancellation retries.
    client.on("error", () => {});

    return {
      isReady: () => client.isReady,
      disconnect() {
        if (client.isOpen) client.destroy();
      },
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
