import { Decimal } from "@meridian/core";
import { describe, expect, it, vi } from "vitest";

import { createExecutorRuntime } from "./executor-runtime.js";
import type { GatewayOrderSnapshot, LocalOrderForReconciliation } from "@meridian/core";

const localOrders: readonly LocalOrderForReconciliation[] = [
  {
    clientOrderId: "mrd_order_1",
    symbol: "BTCUSDT",
    state: "NEW",
    updatedAtMs: 1_704_067_200_000
  }
];

const exchangeOrder: GatewayOrderSnapshot = {
  clientOrderId: "mrd_order_1",
  exchangeOrderId: "123",
  symbol: "BTCUSDT",
  side: "BUY",
  type: "LIMIT",
  status: "NEW",
  executedQuantity: new Decimal("0"),
  cumulativeQuoteQuantity: new Decimal("0"),
  price: new Decimal("83000.91"),
  eventTimeMs: 1_704_067_201_000
};

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

describe("createExecutorRuntime", () => {
  it("runs startup reconciliation as the first runtime start step", async () => {
    const store = {
      listOrdersForReconciliation: vi.fn(async () => localOrders),
      markOrderReconciledTerminal: vi.fn()
    };
    const exchange = {
      getOrder: vi.fn(async () => exchangeOrder)
    };
    const logger = createLogger();
    const runtime = createExecutorRuntime({
      store,
      exchange,
      logger,
      nowMs: () => 1_704_067_220_000
    });

    const result = await runtime.start();

    expect(store.listOrdersForReconciliation).toHaveBeenCalledTimes(1);
    expect(exchange.getOrder).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      clientOrderId: "mrd_order_1"
    });
    expect(result.reconciliationReport.checked).toBe(1);
    expect(result.reconciliationReport.matched).toHaveLength(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        checked: 1,
        matched: 1,
        terminalRepairsApplied: 0
      }),
      "startup order reconciliation completed"
    );
  });

  it("propagates startup reconciliation failures so the runtime fails closed", async () => {
    const error = new Error("database unavailable");
    const store = {
      listOrdersForReconciliation: vi.fn(async (): Promise<readonly LocalOrderForReconciliation[]> => {
        throw error;
      }),
      markOrderReconciledTerminal: vi.fn()
    };
    const exchange = {
      getOrder: vi.fn()
    };
    const logger = createLogger();
    const runtime = createExecutorRuntime({
      store,
      exchange,
      logger
    });

    await expect(runtime.start()).rejects.toBe(error);

    expect(exchange.getOrder).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      { error },
      "startup order reconciliation failed"
    );
  });

  it("can run reconciliation again after a reconnect trigger", async () => {
    const store = {
      listOrdersForReconciliation: vi.fn(async () => localOrders),
      markOrderReconciledTerminal: vi.fn()
    };
    const exchange = {
      getOrder: vi.fn(async () => exchangeOrder)
    };
    const logger = createLogger();
    const runtime = createExecutorRuntime({
      store,
      exchange,
      logger
    });

    const report = await runtime.reconcileAfterReconnect();

    expect(store.listOrdersForReconciliation).toHaveBeenCalledTimes(1);
    expect(exchange.getOrder).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      clientOrderId: "mrd_order_1"
    });
    expect(report.checked).toBe(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        checked: 1,
        matched: 1
      }),
      "reconnect order reconciliation completed"
    );
  });
});
