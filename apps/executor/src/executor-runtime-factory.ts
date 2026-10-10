import {
  createBinanceReconciliationExchange,
  type BinanceReconciliationExchangeClient
} from "@meridian/binance-client";
import { createOrderWriteAheadRepository, type OrderWriteAheadRepositoryDeps } from "@meridian/db";
import type { ExchangeGateway } from "@meridian/core";
import type { RedisStreamClient } from "@meridian/bus";
import type { Registry } from "@meridian/observability";

import { registerExecutorMetrics } from "./executor-metrics.js";
import { runAccountTradeCatchUp } from "./account-trade-catch-up.js";
import { createExecutorRuntime, type ExecutorRuntime } from "./executor-runtime.js";
import { createSignalConsumer, type SignalConsumerLogger } from "./signal-consumer.js";
import type { StartupReconciliationLogger } from "./startup-reconciliation.js";
import type { SignalRiskGate } from "./signal-execution.js";
import type { SignalMessageDeps } from "./signal-execution.js";

export interface ExecutorRuntimeFactoryDeps {
  readonly database: OrderWriteAheadRepositoryDeps;
  readonly binanceClient: BinanceReconciliationExchangeClient & {
    readonly getAccountTrades?: Parameters<typeof runAccountTradeCatchUp>[0]["accountTrades"]["getAccountTrades"];
  };
  readonly logger: StartupReconciliationLogger & SignalConsumerLogger;
  readonly nowMs?: () => number;
  readonly metricsRegistry?: Registry;
  readonly signalConsumer?: {
    readonly bus: RedisStreamClient;
    readonly exchange: Pick<ExchangeGateway, "placeOrder">;
    readonly riskGate?: SignalRiskGate;
    readonly recordRejection?: SignalMessageDeps["recordRejection"];
    readonly beforeSubmit?: SignalMessageDeps["beforeSubmit"];
    readonly group: string;
    readonly consumer: string;
    readonly clientOrderIdPrefix: string;
    readonly readCount?: number;
    readonly blockMs?: number;
    readonly staleMinIdleMs?: number;
  };
}

export function createExecutorRuntimeFromDeps(deps: ExecutorRuntimeFactoryDeps): ExecutorRuntime {
  const store = createOrderWriteAheadRepository(deps.database);
  const metrics =
    deps.metricsRegistry === undefined
      ? undefined
      : registerExecutorMetrics({ registry: deps.metricsRegistry });
  const reconciliationExchange = createBinanceReconciliationExchange({
    client: deps.binanceClient,
    ...(deps.nowMs === undefined ? {} : { nowMs: deps.nowMs })
  });

  const signalConsumer =
    deps.signalConsumer === undefined
      ? undefined
      : createSignalConsumer({
          bus: deps.signalConsumer.bus,
          group: deps.signalConsumer.group,
          consumer: deps.signalConsumer.consumer,
          logger: deps.logger,
          store,
          exchange: {
            ...deps.signalConsumer.exchange,
            getOrder: (request) => reconciliationExchange.getOrder(request)
          },
          ...(deps.signalConsumer.riskGate === undefined
            ? {}
            : { riskGate: deps.signalConsumer.riskGate }),
          clientOrderIdPrefix: deps.signalConsumer.clientOrderIdPrefix,
          ...(deps.signalConsumer.beforeSubmit === undefined
            ? {}
            : { beforeSubmit: deps.signalConsumer.beforeSubmit }),
          ...(deps.signalConsumer.recordRejection === undefined
            ? {}
            : { recordRejection: deps.signalConsumer.recordRejection }),
          nowMs: deps.nowMs ?? Date.now,
          ...(metrics === undefined ? {} : { metrics }),
          ...(deps.signalConsumer.readCount === undefined
            ? {}
            : { readCount: deps.signalConsumer.readCount }),
          ...(deps.signalConsumer.blockMs === undefined
            ? {}
            : { blockMs: deps.signalConsumer.blockMs }),
          ...(deps.signalConsumer.staleMinIdleMs === undefined
            ? {}
            : { staleMinIdleMs: deps.signalConsumer.staleMinIdleMs })
        });

  return createExecutorRuntime({
    store,
    exchange: reconciliationExchange,
    logger: deps.logger,
    ...(deps.binanceClient.getAccountTrades === undefined
      ? {}
      : {
          accountTradeCatchUp: (report) =>
            runAccountTradeCatchUp({
              report,
              accountTrades: { getAccountTrades: deps.binanceClient.getAccountTrades! },
              store
            })
        }),
    ...(deps.nowMs === undefined ? {} : { nowMs: deps.nowMs }),
    ...(signalConsumer === undefined ? {} : { signalConsumer })
  });
}
