import { Decimal } from "@meridian/core";
import { describe, expect, it, vi } from "vitest";

import { runAccountTradeCatchUp } from "./account-trade-catch-up.js";
import type { AccountTradeCatchUpStore } from "./account-trade-catch-up.js";
import type { StartupReconciliationStore } from "./startup-reconciliation.js";

const terminalReport = {
  checked: 1,
  matched: [],
  missingOnExchange: [],
  queryFailed: [],
  terminalOnExchange: [
    {
      clientOrderId: "mrd_order_1",
      symbol: "BTCUSDT",
      localState: "PARTIALLY_FILLED" as const,
      exchangeStatus: "FILLED" as const,
      exchangeOrderId: "123"
    }
  ]
};

function store(): StartupReconciliationStore & AccountTradeCatchUpStore {
  return {
    listOrdersForReconciliation: vi.fn(async () => []),
    markOrderReconciledTerminal: vi.fn(async () => undefined),
    recordOrderExecutionUpdate: vi.fn(async () => undefined)
  };
}

describe("runAccountTradeCatchUp", () => {
  it("converts missed account trades into idempotent persisted order fills", async () => {
    const s = store();
    const accountTrades = {
      getAccountTrades: vi.fn(async () => [
        {
          symbol: "BTCUSDT",
          tradeId: "789",
          orderId: "123",
          price: new Decimal("83000.91"),
          quantity: new Decimal("0.0002"),
          quoteQuantity: new Decimal("16.600182"),
          commission: new Decimal("0.000001"),
          commissionAsset: "BTC",
          eventTimeMs: 1_704_067_201_000,
          side: "BUY" as const
        }
      ])
    };

    const result = await runAccountTradeCatchUp({
      report: terminalReport,
      accountTrades,
      store: s
    });

    expect(accountTrades.getAccountTrades).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      orderId: "123"
    });
    expect(s.recordOrderExecutionUpdate).toHaveBeenCalledWith({
      clientOrderId: "mrd_order_1",
      exchangeOrderId: "123",
      state: "FILLED",
      executedQuantity: "0.0002",
      cumulativeQuoteQuantity: "16.600182",
      exchangeEventTimeMs: 1_704_067_201_000,
      executionId: "rest:789",
      fill: {
        tradeId: "789",
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: "0.0002",
        price: "83000.91",
        fee: "0.000001",
        feeAsset: "BTC"
      }
    });
    expect(result).toEqual({
      ordersChecked: 1,
      tradesFetched: 1,
      fillsPersisted: 1
    });
  });

  it("folds multiple REST trades into monotonic cumulative order updates", async () => {
    const s = store();
    const accountTrades = {
      getAccountTrades: vi.fn(async () => [
        {
          symbol: "BTCUSDT",
          tradeId: "790",
          orderId: "123",
          price: new Decimal("83100"),
          quantity: new Decimal("0.0001"),
          quoteQuantity: new Decimal("8.31"),
          commission: new Decimal("0"),
          commissionAsset: "BTC",
          eventTimeMs: 1_704_067_202_000,
          side: "BUY" as const
        },
        {
          symbol: "BTCUSDT",
          tradeId: "789",
          orderId: "123",
          price: new Decimal("83000"),
          quantity: new Decimal("0.0001"),
          quoteQuantity: new Decimal("8.30"),
          commission: new Decimal("0"),
          commissionAsset: "BTC",
          eventTimeMs: 1_704_067_201_000,
          side: "BUY" as const
        }
      ])
    };

    await runAccountTradeCatchUp({
      report: terminalReport,
      accountTrades,
      store: s
    });

    expect(s.recordOrderExecutionUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        executionId: "rest:789",
        executedQuantity: "0.0001",
        cumulativeQuoteQuantity: "8.3",
        exchangeEventTimeMs: 1_704_067_201_000
      })
    );
    expect(s.recordOrderExecutionUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        executionId: "rest:790",
        executedQuantity: "0.0002",
        cumulativeQuoteQuantity: "16.61",
        exchangeEventTimeMs: 1_704_067_202_000
      })
    );
  });

  it("uses existing repository guards for duplicate trades and older catch-up data", async () => {
    const s = store();
    const accountTrades = {
      getAccountTrades: vi.fn(async () => [
        {
          symbol: "BTCUSDT",
          tradeId: "789",
          orderId: "123",
          price: new Decimal("83000.91"),
          quantity: new Decimal("0.0002"),
          quoteQuantity: new Decimal("16.600182"),
          commission: new Decimal("0"),
          commissionAsset: "USDT",
          eventTimeMs: 1_704_067_100_000,
          side: "BUY" as const
        }
      ])
    };

    await runAccountTradeCatchUp({
      report: terminalReport,
      accountTrades,
      store: s
    });

    expect(s.recordOrderExecutionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: "rest:789",
        fill: expect.objectContaining({ tradeId: "789" })
      })
    );
  });

  it("skips reconciliation items without an exchange order id", async () => {
    const s = store();
    const accountTrades = { getAccountTrades: vi.fn() };

    const result = await runAccountTradeCatchUp({
      report: {
        checked: 1,
        matched: [],
        terminalOnExchange: [],
        queryFailed: [],
        missingOnExchange: [
          {
            clientOrderId: "mrd_order_1",
            symbol: "BTCUSDT",
            localState: "UNKNOWN" as const
          }
        ]
      },
      accountTrades,
      store: s
    });

    expect(accountTrades.getAccountTrades).not.toHaveBeenCalled();
    expect(s.recordOrderExecutionUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({ ordersChecked: 0, tradesFetched: 0, fillsPersisted: 0 });
  });
});
