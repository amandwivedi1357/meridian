import { Decimal } from "@meridian/core";
import { describe, expect, it, vi } from "vitest";

import { runStartupReconciliation } from "./startup-reconciliation.js";
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

describe("runStartupReconciliation", () => {
  it("runs report-only reconciliation from persisted local orders and exchange snapshots", async () => {
    const store = {
      listOrdersForReconciliation: vi.fn(async () => localOrders),
      markOrderReconciledTerminal: vi.fn()
    };
    const exchange = {
      getOrder: vi.fn(async () => exchangeOrder)
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    const report = await runStartupReconciliation({
      store,
      exchange,
      logger
    });

    expect(store.listOrdersForReconciliation).toHaveBeenCalledTimes(1);
    expect(exchange.getOrder).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      clientOrderId: "mrd_order_1"
    });
    expect(report.checked).toBe(1);
    expect(report.matched).toHaveLength(1);
    expect(logger.info).toHaveBeenCalledWith(
      {
        checked: 1,
        matched: 1,
        missingOnExchange: 0,
        terminalOnExchange: 0,
        queryFailed: 0,
        terminalRepairsApplied: 0
      },
      "startup order reconciliation completed"
    );
    expect(store.markOrderReconciledTerminal).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs a warning when reconciliation finds orders that need operator or repair follow-up", async () => {
    const store = {
      listOrdersForReconciliation: vi.fn(async () => localOrders),
      markOrderReconciledTerminal: vi.fn()
    };
    const exchange = {
      getOrder: vi.fn(async () => null)
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    const report = await runStartupReconciliation({
      store,
      exchange,
      logger
    });

    expect(report.missingOnExchange).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      {
        missingOnExchange: 1,
        queryFailed: 0
      },
      "startup order reconciliation needs follow-up"
    );
    expect(logger.warn).toHaveBeenCalledWith(
      {
        checked: 1,
        missingOnExchange: 1
      },
      "startup order reconciliation detected a possible Testnet reset"
    );
    expect(store.markOrderReconciledTerminal).not.toHaveBeenCalled();
  });

  it("applies terminal exchange states back to local storage", async () => {
    const store = {
      listOrdersForReconciliation: vi.fn(async () => localOrders),
      markOrderReconciledTerminal: vi.fn(async () => undefined)
    };
    const exchange = {
      getOrder: vi.fn(async () => ({
        ...exchangeOrder,
        status: "FILLED" as const,
        executedQuantity: new Decimal("0.0002"),
        cumulativeQuoteQuantity: new Decimal("16.600182")
      }))
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    const report = await runStartupReconciliation({
      store,
      exchange,
      logger,
      nowMs: () => 1_704_067_220_000
    });

    expect(report.terminalOnExchange).toHaveLength(1);
    expect(store.markOrderReconciledTerminal).toHaveBeenCalledWith({
      clientOrderId: "mrd_order_1",
      terminalState: "FILLED",
      reconciledAtMs: 1_704_067_220_000
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        terminalOnExchange: 1,
        terminalRepairsApplied: 1
      }),
      "startup order reconciliation completed"
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("logs and rethrows terminal repair failures so executor startup can fail closed", async () => {
    const error = new Error("database update failed");
    const store = {
      listOrdersForReconciliation: vi.fn(async () => localOrders),
      markOrderReconciledTerminal: vi.fn(async () => {
        throw error;
      })
    };
    const exchange = {
      getOrder: vi.fn(async () => ({
        ...exchangeOrder,
        status: "CANCELED" as const
      }))
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    await expect(
      runStartupReconciliation({
        store,
        exchange,
        logger
      })
    ).rejects.toBe(error);

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      { error },
      "startup order reconciliation failed"
    );
  });

  it("logs and rethrows storage failures so executor startup can fail closed", async () => {
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
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    await expect(
      runStartupReconciliation({
        store,
        exchange,
        logger
      })
    ).rejects.toBe(error);

    expect(exchange.getOrder).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      { error },
      "startup order reconciliation failed"
    );
  });
});
