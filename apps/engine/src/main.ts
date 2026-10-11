import { createTestnetTradingClientFromEnv, BinanceRestClient } from "@meridian/binance-client";
import { loadConfig } from "@meridian/config";
import { Decimal, allocationFromEnv } from "@meridian/core";
import { createTestnetAllocationRepository, testnetAccountBinding } from "@meridian/db";
import { createAllocatedAccountState } from "./allocated-account-state.js";
import {
  createLogger,
  createShutdownGuard,
  createMetricsRegistry,
  createServiceDiagnostics,
  diagnosticsAddress
} from "@meridian/observability";
import { pathToFileURL } from "node:url";

import { createEngineEmaCrossoverStrategy } from "./ema-crossover-strategy.js";
import { createEngineRuntimeFromDeps } from "./engine-runtime-factory.js";
import { createEngineMainEntry } from "./main-entry.js";
import { runEngineMain, type EngineMainResult } from "./main-runner.js";
import { createLiveAccountState } from "./live-account-state.js";
import { createLiveFillReader } from "./live-fill-reader.js";
import { createEngineRuntimeClients } from "./runtime-clients.js";
import { createStrategyControlReader } from "./strategy-control-reader.js";

const logger = createLogger("engine");

export async function runCliMain(): Promise<EngineMainResult> {
  const config = loadConfig();
  const clients = createEngineRuntimeClients({
    postgresUrl: config.DATABASE_URL,
    redisUrl: config.REDIS_URL
  });
  let running = true;
  let markStopping = () => {};
  const stop = () => {
    running = false;
    markStopping();
  };
  const shutdown = createShutdownGuard({ onStop: stop });
  const tradingClient = await createTestnetTradingClientFromEnv({ autoSynchronizeTime: true });
  const symbol = process.env.ENGINE_SYMBOL ?? "BTCUSDT";
  const interval = readInterval(process.env.ENGINE_INTERVAL ?? "15m");
  const strategy = createEngineEmaCrossoverStrategy({
    symbol,
    interval,
    fastPeriod: readPositiveInteger(process.env.ENGINE_FAST_PERIOD ?? "12", "ENGINE_FAST_PERIOD"),
    slowPeriod: readPositiveInteger(process.env.ENGINE_SLOW_PERIOD ?? "26", "ENGINE_SLOW_PERIOD"),
    quantity: new Decimal(process.env.ENGINE_QUANTITY ?? "0.0002")
  });
  let lastPoll = 0;
  const metricsRegistry = createMetricsRegistry("engine");
  const diagnostics = createServiceDiagnostics({
    service: "engine",
    registry: metricsRegistry,
    async checkReady() {
      if (!running || lastPoll === 0 || Date.now() - lastPoll >= 10000) return false;
      await clients.postgres.query({ text: "SELECT 1", values: [] });
      return running && lastPoll > 0 && Date.now() - lastPoll < 10000;
    }
  });

  markStopping = () => diagnostics.stopping();

  try {
    if (!running) throw new Error("Engine startup cancelled");
    await diagnostics.listen(diagnosticsAddress("engine"));
    await clients.redis.connect();
    await tradingClient.synchronizeTime();

    const fillReader = createLiveFillReader({
      query: clients.postgres.query
    });
    const allocation = allocationFromEnv(process.env);
    const allocationRepo = createTestnetAllocationRepository({
      async execute(query) {
        return { ...(await clients.postgres.query(query)), rowCount: null };
      }
    });
    const binding = allocation ? testnetAccountBinding(process.env.BINANCE_API_KEY) : undefined;
    const assertPolicy = () => allocationRepo.assertPolicy(allocation, binding);
    await assertPolicy();
    if (allocation && !allocation.symbols.includes(symbol))
      throw new Error("Engine symbol outside allocated portfolio");
    const accountState = allocation
      ? createAllocatedAccountState({
          policy: allocation,
          publicClient: new BinanceRestClient({ environment: "testnet" }),
          tradingClient,
          fillReader,
          assertPolicy,
          backingBaseline: allocationRepo.backingBaseline,
          listManagedOrders: allocationRepo.listManagedOrders
        })
      : createLiveAccountState({
          listFills: fillReader.listFills,
          async getBalances() {
            await assertPolicy();
            return tradingClient.getBalances();
          }
        });

    const runtime = createEngineRuntimeFromDeps({
      metricsRegistry,
      isStopping: () => !running,
      bus: clients.redis,
      strategy,
      symbol,
      interval,
      logger,
      group: "engine",
      consumer: `engine-${process.pid}`,
      accountState,
      isStrategyPaused: createStrategyControlReader(clients.postgres).isPaused,
      signalTtlMs: readPositiveInteger(
        process.env.ENGINE_SIGNAL_TTL_MS ?? "5000",
        "ENGINE_SIGNAL_TTL_MS"
      ),
      maxMarketDataAgeMs: readPositiveInteger(
        process.env.ENGINE_MAX_MARKET_DATA_AGE_MS ?? "30000",
        "ENGINE_MAX_MARKET_DATA_AGE_MS"
      )
    });
    const main = createEngineMainEntry({
      run() {
        return runEngineMain({
          runtime: {
            async start() {
              await runtime.start();
              diagnostics.started();
            },
            async pollMarketOnce() {
              try {
                const result = await diagnostics.measure(
                  "market_poll",
                  () => runtime.pollMarketOnce(),
                  (n) => n
                );
                lastPoll = Date.now();
                return result;
              } catch (error) {
                lastPoll = 0;
                throw error;
              }
            }
          },
          logger,
          shouldContinue: () => running,
          sleepMs: sleep,
          idleDelayMs: 250,
          errorDelayMs: 1_000
        });
      }
    });

    return await main();
  } finally {
    diagnostics.stopping();
    try {
      await tradingClient.close();
    } finally {
      try {
        await clients.close();
      } finally {
        await diagnostics.close();
      }
    }
    shutdown.finish();
  }
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function readPositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function readInterval(value: string): "1m" | "5m" | "15m" | "1h" {
  if (value === "1m" || value === "5m" || value === "15m" || value === "1h") {
    return value;
  }

  throw new Error("ENGINE_INTERVAL must be one of 1m, 5m, 15m, or 1h");
}

function isEntrypoint(): boolean {
  return process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
}

if (isEntrypoint()) {
  runCliMain()
    .then((result) => {
      logger.info({ result }, "engine stopped");
    })
    .catch((error: unknown) => {
      logger.error({ err: error }, "engine failed");
      process.exitCode = 1;
    });
}
