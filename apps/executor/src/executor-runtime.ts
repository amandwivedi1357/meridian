import type { OrderReconciliationReport } from "@meridian/core";

import {
  runStartupReconciliation,
  type StartupReconciliationLogger,
  type StartupReconciliationStore
} from "./startup-reconciliation.js";
import type { ReconciliationExchange } from "@meridian/core";

export interface ExecutorRuntimeDeps {
  readonly store: StartupReconciliationStore;
  readonly exchange: ReconciliationExchange;
  readonly logger: StartupReconciliationLogger;
  readonly nowMs?: () => number;
}

export interface ExecutorRuntime {
  readonly start: () => Promise<{
    readonly reconciliationReport: OrderReconciliationReport;
  }>;
  readonly reconcileAfterReconnect: () => Promise<OrderReconciliationReport>;
}

export function createExecutorRuntime(deps: ExecutorRuntimeDeps): ExecutorRuntime {
  async function reconcile(reason: "startup" | "reconnect"): Promise<OrderReconciliationReport> {
    return runStartupReconciliation({
      store: deps.store,
      exchange: deps.exchange,
      logger: deps.logger,
      reason,
      ...(deps.nowMs === undefined ? {} : { nowMs: deps.nowMs })
    });
  }

  return {
    async start() {
      const reconciliationReport = await reconcile("startup");

      return { reconciliationReport };
    },

    async reconcileAfterReconnect() {
      return reconcile("reconnect");
    }
  };
}
