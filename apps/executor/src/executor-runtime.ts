import type { OrderReconciliationReport } from "@meridian/core";
import type { SignalProcessingResult } from "./signal-execution.js";

import {
  runStartupReconciliation,
  type StartupReconciliationLogger,
  type StartupReconciliationStore
} from "./startup-reconciliation.js";
import type { AccountTradeCatchUpResult } from "./account-trade-catch-up.js";
import type { ReconciliationExchange } from "@meridian/core";

export interface ExecutorSignalConsumer {
  readonly ensureReady: () => Promise<void>;
  readonly pollOnce: () => Promise<readonly SignalProcessingResult[]>;
  readonly claimStaleOnce: () => Promise<readonly SignalProcessingResult[]>;
}

export interface ExecutorRuntimeDeps {
  readonly store: StartupReconciliationStore;
  readonly exchange: ReconciliationExchange;
  readonly logger: StartupReconciliationLogger;
  readonly accountTradeCatchUp?: (report: OrderReconciliationReport) => Promise<AccountTradeCatchUpResult>;
  readonly nowMs?: () => number;
  readonly signalConsumer?: ExecutorSignalConsumer;
}

export interface ExecutorRuntime {
  readonly start: () => Promise<{
    readonly reconciliationReport: OrderReconciliationReport;
  }>;
  readonly reconcileAfterReconnect: () => Promise<OrderReconciliationReport>;
  readonly pollSignalsOnce: () => Promise<readonly SignalProcessingResult[]>;
  readonly claimStaleSignalsOnce: () => Promise<readonly SignalProcessingResult[]>;
}

export function createExecutorRuntime(deps: ExecutorRuntimeDeps): ExecutorRuntime {
  async function reconcile(reason: "startup" | "reconnect"): Promise<OrderReconciliationReport> {
    return runStartupReconciliation({
      store: deps.store,
      exchange: deps.exchange,
      logger: deps.logger,
      reason,
      ...(deps.accountTradeCatchUp === undefined
        ? {}
        : { accountTradeCatchUp: deps.accountTradeCatchUp }),
      ...(deps.nowMs === undefined ? {} : { nowMs: deps.nowMs })
    });
  }

  async function requireSignalConsumer(): Promise<ExecutorSignalConsumer> {
    if (deps.signalConsumer === undefined) {
      throw new Error("Signal consumer is not configured");
    }

    return deps.signalConsumer;
  }

  return {
    async start() {
      const reconciliationReport = await reconcile("startup");

      if (deps.signalConsumer !== undefined) {
        await deps.signalConsumer.ensureReady();
      }

      return { reconciliationReport };
    },

    async reconcileAfterReconnect() {
      return reconcile("reconnect");
    },

    async pollSignalsOnce() {
      const signalConsumer = await requireSignalConsumer();
      return signalConsumer.pollOnce();
    },

    async claimStaleSignalsOnce() {
      const signalConsumer = await requireSignalConsumer();
      return signalConsumer.claimStaleOnce();
    }
  };
}
