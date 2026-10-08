import {
  createBinanceReconciliationExchange,
  type BinanceReconciliationExchangeClient
} from "@meridian/binance-client";
import { createOrderWriteAheadRepository, type OrderWriteAheadRepositoryDeps } from "@meridian/db";

import { createExecutorRuntime, type ExecutorRuntime } from "./executor-runtime.js";
import type { StartupReconciliationLogger } from "./startup-reconciliation.js";

export interface ExecutorRuntimeFactoryDeps {
  readonly database: OrderWriteAheadRepositoryDeps;
  readonly binanceClient: BinanceReconciliationExchangeClient;
  readonly logger: StartupReconciliationLogger;
  readonly nowMs?: () => number;
}

export function createExecutorRuntimeFromDeps(
  deps: ExecutorRuntimeFactoryDeps
): ExecutorRuntime {
  const store = createOrderWriteAheadRepository(deps.database);
  const exchange = createBinanceReconciliationExchange({
    client: deps.binanceClient,
    ...(deps.nowMs === undefined ? {} : { nowMs: deps.nowMs })
  });

  return createExecutorRuntime({
    store,
    exchange,
    logger: deps.logger,
    ...(deps.nowMs === undefined ? {} : { nowMs: deps.nowMs })
  });
}
