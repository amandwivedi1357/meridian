import { Decimal } from "decimal.js";
import { describe, expect, it, vi } from "vitest";

import {
  reconcileOpenOrders,
  runOrderReconciliation,
  type LocalOrderForReconciliation,
  type ReconciliationExchange
} from "./order-reconciliation.js";
import type { GatewayOrderSnapshot } from "./exchange.js";

function localOrder(
  override: Partial<LocalOrderForReconciliation> = {}
): LocalOrderForReconciliation {
  return {
    clientOrderId: "mrd_order_1",
    symbol: "BTCUSDT",
    state: "NEW",
    updatedAtMs: 1_704_067_200_000,
    ...override
  };
}

function exchangeOrder(
  override: Partial<GatewayOrderSnapshot> = {}
): GatewayOrderSnapshot {
  return {
    clientOrderId: "mrd_order_1",
    exchangeOrderId: "123",
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    status: "NEW",
    executedQuantity: new Decimal("0"),
    cumulativeQuoteQuantity: new Decimal("0"),
    price: new Decimal("83000.91"),
    eventTimeMs: 1_704_067_201_000,
    ...override
  };
}

function exchangeWith(
  orders: Record<string, GatewayOrderSnapshot | null | Error>
): ReconciliationExchange {
  return {
    getOrder: vi.fn(async ({ clientOrderId }) => {
      const result = orders[clientOrderId];
      if (result instanceof Error) throw result;
      return result ?? null;
    })
  };
}

describe("reconcileOpenOrders", () => {
  it("reports local non-terminal orders that match exchange snapshots", async () => {
    const exchange = exchangeWith({
      mrd_order_1: exchangeOrder()
    });

    const report = await reconcileOpenOrders({
      localOrders: [localOrder()],
      exchange
    });

    expect(report).toEqual({
      checked: 1,
      matched: [
        {
          clientOrderId: "mrd_order_1",
          symbol: "BTCUSDT",
          localState: "NEW",
          exchangeStatus: "NEW",
          exchangeOrderId: "123"
        }
      ],
      missingOnExchange: [],
      terminalOnExchange: [],
      queryFailed: []
    });
    expect(exchange.getOrder).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      clientOrderId: "mrd_order_1"
    });
  });

  it("ignores local terminal orders because they do not require open-order reconciliation", async () => {
    const exchange = exchangeWith({});

    const report = await reconcileOpenOrders({
      localOrders: [
        localOrder({ clientOrderId: "filled", state: "FILLED" }),
        localOrder({ clientOrderId: "canceled", state: "CANCELED" }),
        localOrder({ clientOrderId: "rejected", state: "REJECTED" }),
        localOrder({ clientOrderId: "expired", state: "EXPIRED" })
      ],
      exchange
    });

    expect(report.checked).toBe(0);
    expect(exchange.getOrder).not.toHaveBeenCalled();
  });

  it("reports non-terminal local orders missing on the exchange", async () => {
    const exchange = exchangeWith({
      mrd_order_1: null
    });

    const report = await reconcileOpenOrders({
      localOrders: [localOrder()],
      exchange
    });

    expect(report.missingOnExchange).toEqual([
      {
        clientOrderId: "mrd_order_1",
        symbol: "BTCUSDT",
        localState: "NEW"
      }
    ]);
    expect(report.matched).toEqual([]);
  });

  it("reports exchange terminal states separately so callers can decide the repair", async () => {
    const exchange = exchangeWith({
      mrd_order_1: exchangeOrder({
        status: "FILLED",
        executedQuantity: new Decimal("0.0002"),
        cumulativeQuoteQuantity: new Decimal("16.600182")
      })
    });

    const report = await reconcileOpenOrders({
      localOrders: [localOrder({ state: "PENDING_CANCEL" })],
      exchange
    });

    expect(report.terminalOnExchange).toEqual([
      {
        clientOrderId: "mrd_order_1",
        symbol: "BTCUSDT",
        localState: "PENDING_CANCEL",
        exchangeStatus: "FILLED",
        exchangeOrderId: "123"
      }
    ]);
    expect(report.matched).toEqual([]);
  });

  it("reports query failures without stopping the full reconciliation pass", async () => {
    const exchange = exchangeWith({
      first: new Error("temporary exchange outage"),
      second: exchangeOrder({ clientOrderId: "second", exchangeOrderId: "456" })
    });

    const report = await reconcileOpenOrders({
      localOrders: [
        localOrder({ clientOrderId: "first" }),
        localOrder({ clientOrderId: "second" })
      ],
      exchange
    });

    expect(report.queryFailed).toEqual([
      {
        clientOrderId: "first",
        symbol: "BTCUSDT",
        localState: "NEW",
        reason: "temporary exchange outage"
      }
    ]);
    expect(report.matched).toEqual([
      {
        clientOrderId: "second",
        symbol: "BTCUSDT",
        localState: "NEW",
        exchangeStatus: "NEW",
        exchangeOrderId: "456"
      }
    ]);
  });
});

describe("runOrderReconciliation", () => {
  it("loads local reconciliation candidates from storage before querying the exchange", async () => {
    const localOrders = [
      localOrder({
        clientOrderId: "local-1",
        symbol: "BTCUSDT",
        state: "NEW"
      })
    ];

    const store = {
      listOrdersForReconciliation: vi.fn(async () => localOrders)
    };
    const exchange = exchangeWith({
      "local-1": exchangeOrder({
        clientOrderId: "local-1",
        exchangeOrderId: "exchange-1",
        status: "NEW"
      })
    });

    const report = await runOrderReconciliation({ store, exchange });

    expect(store.listOrdersForReconciliation).toHaveBeenCalledTimes(1);
    expect(exchange.getOrder).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      clientOrderId: "local-1"
    });
    expect(report).toMatchObject({
      checked: 1,
      matched: [
        {
          clientOrderId: "local-1",
          symbol: "BTCUSDT",
          localState: "NEW",
          exchangeStatus: "NEW",
          exchangeOrderId: "exchange-1"
        }
      ],
      missingOnExchange: [],
      terminalOnExchange: [],
      queryFailed: []
    });
  });

  it("propagates storage failures so startup can fail safe before exchange queries", async () => {
    const store = {
      listOrdersForReconciliation: vi.fn(async (): Promise<readonly LocalOrderForReconciliation[]> => {
        throw new Error("database unavailable");
      })
    };
    const exchange = exchangeWith({});

    await expect(runOrderReconciliation({ store, exchange })).rejects.toThrow(
      "database unavailable"
    );

    expect(exchange.getOrder).not.toHaveBeenCalled();
  });
});
