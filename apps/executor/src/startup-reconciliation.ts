import { runOrderReconciliation, type OrderReconciliationReport } from "@meridian/core";
import type { OrderReconciliationStore, OrderState, ReconciliationExchange } from "@meridian/core";

export interface StartupReconciliationLogger {
  readonly info: (data: Record<string, unknown>, message: string) => void;
  readonly warn: (data: Record<string, unknown>, message: string) => void;
  readonly error: (data: Record<string, unknown>, message: string) => void;
}

export interface StartupReconciliationOptions {
  readonly store: StartupReconciliationStore;
  readonly exchange: ReconciliationExchange;
  readonly logger: StartupReconciliationLogger;
  readonly nowMs?: () => number;
  readonly reason?: "startup" | "reconnect";
}

export interface StartupReconciliationStore extends OrderReconciliationStore {
  readonly markOrderReconciledTerminal: (record: {
    readonly clientOrderId: string;
    readonly terminalState: Extract<OrderState, "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED">;
    readonly reconciledAtMs: number;
  }) => Promise<void>;
}

export async function runStartupReconciliation(
  options: StartupReconciliationOptions
): Promise<OrderReconciliationReport> {
  const reason = options.reason ?? "startup";

  try {
    const report = await runOrderReconciliation({
      store: options.store,
      exchange: options.exchange
    });
    await applyTerminalRepairs(options.store, report, options.nowMs ?? Date.now);
    const summary = summarizeReport(report);

    options.logger.info(
      {
        ...summary,
        terminalRepairsApplied: report.terminalOnExchange.length
      },
      `${reason} order reconciliation completed`
    );

    if (summary.missingOnExchange > 0 || summary.queryFailed > 0) {
      options.logger.warn(
        {
          missingOnExchange: summary.missingOnExchange,
          queryFailed: summary.queryFailed
        },
        `${reason} order reconciliation needs follow-up`
      );
    }

    if (isPossibleTestnetReset(summary)) {
      options.logger.warn(
        {
          checked: summary.checked,
          missingOnExchange: summary.missingOnExchange
        },
        `${reason} order reconciliation detected a possible Testnet reset`
      );
    }

    return report;
  } catch (error) {
    options.logger.error({ error }, `${reason} order reconciliation failed`);
    throw error;
  }
}

function isPossibleTestnetReset(summary: ReturnType<typeof summarizeReport>): boolean {
  return (
    summary.checked > 0 &&
    summary.missingOnExchange === summary.checked &&
    summary.matched === 0 &&
    summary.terminalOnExchange === 0 &&
    summary.queryFailed === 0
  );
}

function summarizeReport(report: OrderReconciliationReport): {
  readonly checked: number;
  readonly matched: number;
  readonly missingOnExchange: number;
  readonly terminalOnExchange: number;
  readonly queryFailed: number;
} {
  return {
    checked: report.checked,
    matched: report.matched.length,
    missingOnExchange: report.missingOnExchange.length,
    terminalOnExchange: report.terminalOnExchange.length,
    queryFailed: report.queryFailed.length
  };
}

async function applyTerminalRepairs(
  store: StartupReconciliationStore,
  report: OrderReconciliationReport,
  nowMs: () => number
): Promise<void> {
  for (const item of report.terminalOnExchange) {
    await store.markOrderReconciledTerminal({
      clientOrderId: item.clientOrderId,
      terminalState: item.exchangeStatus,
      reconciledAtMs: nowMs()
    });
  }
}
