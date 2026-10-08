import {
  createBinanceExchangeGateway,
  createQueryBeforeRetryOrderSubmitter,
  createTestnetTradingClientFromEnv
} from "@meridian/binance-client";
import { loadConfig } from "@meridian/config";
import { createLogger, createMetricsRegistry } from "@meridian/observability";
import { pathToFileURL } from "node:url";

import { createExecutorRuntimeFromDeps } from "./executor-runtime-factory.js";
import { createExecutorMainEntry } from "./main-entry.js";
import { runExecutorMain, type ExecutorMainResult } from "./main-runner.js";
import { createExecutorRuntimeClients } from "./runtime-clients.js";

const logger = createLogger("executor");

export async function runCliMain(): Promise<ExecutorMainResult> {
  const config = loadConfig();
  const clients = createExecutorRuntimeClients({
    postgresUrl: config.DATABASE_URL,
    redisUrl: config.REDIS_URL
  });
  const metricsRegistry = createMetricsRegistry("executor");
  const tradingClient = await createTestnetTradingClientFromEnv();
  const safeOrderSubmitter = createQueryBeforeRetryOrderSubmitter(tradingClient);
  const placementGateway = createBinanceExchangeGateway({
    client: {
      ...tradingClient,
      async placeOrder(input) {
        const result = await safeOrderSubmitter.placeOrder(input);
        return result.order;
      }
    }
  });
  let running = true;

  const stop = () => {
    running = false;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await clients.redis.connect();
    await tradingClient.synchronizeTime();

    const runtime = createExecutorRuntimeFromDeps({
      database: clients.postgres,
      binanceClient: tradingClient,
      logger,
      metricsRegistry,
      signalConsumer: {
        bus: clients.redis,
        exchange: placementGateway,
        group: "executor",
        consumer: `executor-${process.pid}`,
        clientOrderIdPrefix: "mrd",
        readCount: 10,
        blockMs: 1_000,
        staleMinIdleMs: 30_000
      }
    });
    const main = createExecutorMainEntry({
      run() {
        return runExecutorMain({
          runtime,
          logger,
          shouldContinue: () => running,
          sleepMs: sleep,
          idleDelayMs: 250,
          errorDelayMs: 1_000,
          staleClaimIntervalMs: 30_000,
          nowMs: Date.now
        });
      }
    });

    return await main();
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await tradingClient.close();
    await clients.close();
  }
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function isEntrypoint(): boolean {
  return process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
}

if (isEntrypoint()) {
  runCliMain()
    .then((result) => {
      logger.info({ result }, "executor stopped");
    })
    .catch((error: unknown) => {
      logger.error({ err: error }, "executor failed");
      process.exitCode = 1;
    });
}
