import {
  createBinanceExchangeGateway,
  createQueryBeforeRetryOrderSubmitter,
  createTestnetTradingClientFromEnv,
  BinanceRestClient
} from "@meridian/binance-client";
import { loadConfig } from "@meridian/config";
import { allocationFromEnv } from "@meridian/core";
import { createLogger, createMetricsRegistry, Counter, Gauge } from "@meridian/observability";
import { pathToFileURL } from "node:url";

import { createExecutorRuntimeFromDeps } from "./executor-runtime-factory.js";
import { createExecutorMainEntry } from "./main-entry.js";
import { runExecutorMain, type ExecutorMainResult } from "./main-runner.js";
import { createExecutorRuntimeClients } from "./runtime-clients.js";
import {
  createOrderWriteAheadRepository,
  createRiskRepository,
  marketDataMigrations,
  runMigrations,
  createTestnetAllocationRepository,
  testnetAccountBinding
} from "@meridian/db";
import { createExecutorUserDataTracker } from "./user-data-tracker.js";
import { createRiskEngine } from "./risk-engine.js";
import { createKillSwitch } from "./kill-switch.js";
import { loadRiskConfig } from "./risk-config.js";
import { createRiskSnapshotReader } from "./risk-snapshot.js";

const logger = createLogger("executor");

export async function runCliMain(): Promise<ExecutorMainResult> {
  const config = loadConfig();
  const riskConfig = loadRiskConfig();
  const clients = createExecutorRuntimeClients({
    postgresUrl: config.DATABASE_URL,
    redisUrl: config.REDIS_URL
  });
  const metricsRegistry = createMetricsRegistry("executor");
  const tradingClient = await createTestnetTradingClientFromEnv({ autoSynchronizeTime: true });
  const publicClient = new BinanceRestClient({ environment: "testnet" });
  const riskRepo = createRiskRepository(clients.postgres);
  const allocation = allocationFromEnv(process.env);
  const allocationRepo = createTestnetAllocationRepository(clients.postgres);
  const accountBinding = allocation
    ? testnetAccountBinding(process.env.BINANCE_API_KEY)
    : undefined;
  const assertPortfolioPolicy = () => allocationRepo.assertPolicy(allocation, accountBinding);
  const killMetric = new Gauge({
    name: "kill_switch_active",
    help: "Whether execution is blocked by the kill switch",
    registers: [metricsRegistry]
  });
  const rejections = new Counter({
    name: "risk_rejections_total",
    help: "Rejected signal messages",
    labelNames: ["reason"],
    registers: [metricsRegistry]
  });
  const killSwitch = createKillSwitch({
    repo: riskRepo,
    command: clients.redis.command,
    async listOpenOrders() {
      const orders = await tradingClient.openOrders();
      if (!allocation) return orders;
      const managed = new Map(
        (await allocationRepo.listManagedOrders()).map((order) => [
          order.clientOrderId,
          order.symbol
        ])
      );
      return orders.filter((order) => managed.get(order.clientOrderId) === order.symbol);
    },
    cancelOrder: tradingClient.cancelOrder,
    alert(details) {
      killMetric.set(1);
      logger.error(details, "risk kill-switch alert; cancellation will retry");
    }
  });
  let tracker: ReturnType<typeof createExecutorUserDataTracker> | undefined;
  const safeOrderSubmitter = createQueryBeforeRetryOrderSubmitter(tradingClient);
  const placementGateway = createBinanceExchangeGateway({
    client: {
      ...tradingClient,
      async placeOrder(input) {
        if (tracker === undefined) throw new Error("User-data tracker is not configured");
        await tracker.assertReady();
        await killSwitch.assertSafe();
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
    try {
      await clients.redis.connect();
    } catch {
      logger.error({}, "Redis unavailable; kill-switch checks and cancellation will retry");
    }
    await runMigrations(marketDataMigrations, {
      async execute(query) {
        await clients.postgres.execute(query);
      },
      async hasMigrationRun(id) {
        const result = await clients.postgres.execute({
          text: "SELECT id FROM schema_migrations WHERE id = $1",
          values: [id]
        });
        if (result.rows === undefined) throw new Error("Migration state unavailable");
        return result.rows.length > 0;
      }
    });
    try {
      await tradingClient.synchronizeTime();
    } catch {
      logger.error(
        {},
        "Exchange clock unavailable; execution blocked until synchronization succeeds"
      );
    }

    await assertPortfolioPolicy();
    logger.info({ portfolio: allocation ?? "full-wallet" }, "risk portfolio scope");
    await killSwitch.check();
    const snapshot = createRiskSnapshotReader({
      publicClient,
      tradingClient,
      repo: riskRepo,
      quoteAsset: riskConfig.quoteAsset,
      assertPortfolioPolicy,
      ...(allocation
        ? {
            allocation: {
              policy: allocation,
              assertPolicy: assertPortfolioPolicy,
              backingBaseline: allocationRepo.backingBaseline,
              listManagedOrders: allocationRepo.listManagedOrders
            }
          }
        : {}),
      symbols: (process.env.EXECUTOR_RISK_SYMBOLS ?? "BTCUSDT")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    });
    const riskGate = createRiskEngine({
      repo: riskRepo,
      killSwitch,
      config: riskConfig,
      snapshot,
      assertPortfolioPolicy,
      async assertReady() {
        if (tracker === undefined) throw new Error("User-data tracker is not configured");
        await tracker.assertReady();
      }
    });

    const runtime = createExecutorRuntimeFromDeps({
      database: clients.postgres,
      binanceClient: tradingClient,
      logger,
      metricsRegistry,
      signalConsumer: {
        bus: clients.redis,
        exchange: placementGateway,
        riskGate,
        async beforeSubmit(signal) {
          const decision = await riskGate.evaluate(signal);
          if (!decision.approved) {
            await riskRepo.recordEvent("submission-blocked", {
              signalId: signal.signalId,
              reason: decision.reason
            });
            throw new Error(`Final risk check blocked: ${decision.reason}`);
          }
        },
        async recordRejection(details) {
          await riskRepo.recordEvent("signal-rejected", details);
          rejections.inc({ reason: details.reason.split(":")[0] ?? "unknown" });
        },
        group: "executor",
        consumer: `executor-${process.pid}`,
        clientOrderIdPrefix: "mrd",
        readCount: 10,
        blockMs: 1_000,
        staleMinIdleMs: 30_000
      }
    });
    tracker = createExecutorUserDataTracker({
      stream: tradingClient.userData,
      store: createOrderWriteAheadRepository(clients.postgres),
      async reconcile() {
        const report = await runtime.reconcileAfterReconnect();
        if (report.queryFailed.length > 0 || report.missingOnExchange.length > 0) {
          throw new Error("Unresolved order reconciliation; execution blocked");
        }
      },
      onError(error) {
        logger.error({ err: error }, "user-data persistence failed; execution blocked");
      }
    });
    try {
      await tracker.start();
    } catch (error) {
      logger.error({ err: error }, "user-data startup unavailable; execution blocked");
      try {
        await killSwitch.engage("user-data-startup-unavailable");
      } catch {
        logger.error({}, "kill switch cancellation/persistence will retry");
      }
    }
    let nextPortfolioCheck = 0;
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
          nowMs: Date.now,
          async onStartupFailure(error) {
            logger.error({ err: error }, "executor startup unavailable; execution blocked");
            try {
              await killSwitch.engage("executor-startup-unavailable");
            } catch {
              logger.error({}, "kill switch cancellation/persistence will retry");
            }
          },
          async safetyTick() {
            try {
              await clients.redis.connect();
            } catch {
              /* Kill checks latch the outage and retry cancellation. */
            }
            const engaged = await killSwitch.check();
            killMetric.set(engaged ? 1 : 0);
            if (!engaged && Date.now() >= nextPortfolioCheck) {
              nextPortfolioCheck = Date.now() + 5_000;
              await riskGate.monitor();
            }
          }
        });
      }
    });

    return await main();
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await tracker?.close();
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
