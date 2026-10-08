import { describe, expect, it, vi } from "vitest";

import { createExecutorRuntimeFromDeps } from "./executor-runtime-factory.js";
import type { SqlQuery } from "@meridian/db";
import type { BinanceOrderResponse } from "@meridian/binance-client";

const order: BinanceOrderResponse = {
  symbol: "BTCUSDT",
  orderId: 123,
  orderListId: -1,
  clientOrderId: "mrd_order_1",
  price: "83000.91000000",
  origQty: "0.00020000",
  executedQty: "0.00000000",
  cummulativeQuoteQty: "0.00000000",
  status: "NEW",
  timeInForce: "GTC",
  type: "LIMIT",
  side: "BUY",
  updateTime: 1_704_067_201_000
};

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

describe("createExecutorRuntimeFromDeps", () => {
  it("does not touch database or Binance during factory construction", () => {
    const execute = vi.fn();
    const queryOrder = vi.fn();

    createExecutorRuntimeFromDeps({
      database: { execute },
      binanceClient: { queryOrder },
      logger: createLogger()
    });

    expect(execute).not.toHaveBeenCalled();
    expect(queryOrder).not.toHaveBeenCalled();
  });

  it("scans persisted local orders and queries Binance when runtime starts", async () => {
    const queries: SqlQuery[] = [];
    const execute = vi.fn(async (query: SqlQuery) => {
      queries.push(query);
      return {
        rowCount: 1,
        rows: [
          {
            client_order_id: "mrd_order_1",
            symbol: "BTCUSDT",
            state: "NEW",
            updated_at_ms: "1704067200000"
          }
        ]
      };
    });
    const queryOrder = vi.fn(async () => order);
    const runtime = createExecutorRuntimeFromDeps({
      database: { execute },
      binanceClient: { queryOrder },
      logger: createLogger()
    });

    const result = await runtime.start();

    expect(normalizeSql(queries[0]?.text ?? "")).toContain("from orders");
    expect(queryOrder).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      clientOrderId: "mrd_order_1"
    });
    expect(result.reconciliationReport.checked).toBe(1);
    expect(result.reconciliationReport.matched).toHaveLength(1);
  });

  it("repairs terminal exchange states through the write-ahead repository", async () => {
    const queries: SqlQuery[] = [];
    const execute = vi.fn(async (query: SqlQuery) => {
      queries.push(query);
      if (normalizeSql(query.text).startsWith("select")) {
        return {
          rowCount: 1,
          rows: [
            {
              client_order_id: "mrd_order_1",
              symbol: "BTCUSDT",
              state: "PENDING_CANCEL",
              updated_at_ms: "1704067200000"
            }
          ]
        };
      }

      return { rowCount: 1 };
    });
    const queryOrder = vi.fn(async () => ({
      ...order,
      status: "CANCELED" as const
    }));
    const runtime = createExecutorRuntimeFromDeps({
      database: { execute },
      binanceClient: { queryOrder },
      logger: createLogger(),
      nowMs: () => 1_704_067_220_000
    });

    const result = await runtime.start();

    const repairQuery = queries.find((query) => normalizeSql(query.text).startsWith("update"));
    expect(result.reconciliationReport.terminalOnExchange).toHaveLength(1);
    expect(repairQuery).toBeDefined();
    expect(normalizeSql(repairQuery?.text ?? "")).toContain("update orders");
    expect(repairQuery?.values).toEqual([
      "mrd_order_1",
      "CANCELED",
      new Date(1_704_067_220_000)
    ]);
  });

  it("wires reconnect-triggered reconciliation through the same dependencies", async () => {
    const execute = vi.fn(async () => ({
      rowCount: 1,
      rows: [
        {
          client_order_id: "mrd_order_1",
          symbol: "BTCUSDT",
          state: "NEW",
          updated_at_ms: "1704067200000"
        }
      ]
    }));
    const queryOrder = vi.fn(async () => order);
    const logger = createLogger();
    const runtime = createExecutorRuntimeFromDeps({
      database: { execute },
      binanceClient: { queryOrder },
      logger
    });

    const report = await runtime.reconcileAfterReconnect();

    expect(report.checked).toBe(1);
    expect(queryOrder).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      clientOrderId: "mrd_order_1"
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        checked: 1,
        matched: 1
      }),
      "reconnect order reconciliation completed"
    );
  });
});

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}
