import { describe, expect, it, vi } from "vitest";
import { Registry } from "@meridian/observability";

import { createExecutorRuntimeFromDeps } from "./executor-runtime-factory.js";
import { Decimal, serializeSignal, type GatewayOrderResult, type Signal } from "@meridian/core";
import type { RedisStreamClient } from "@meridian/bus";
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

function signal(override: Partial<Signal> = {}): Signal {
  return {
    signalId: "sig_1",
    strategyId: "ema",
    createdAtMs: 1_000,
    validUntilMs: 2_000,
    intent: {
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: new Decimal("0.0002"),
      limitPrice: new Decimal("83000.91"),
      reason: "EMA bullish crossover"
    },
    ...override
  };
}

function gatewayOrderResult(clientOrderId: string): GatewayOrderResult {
  return {
    clientOrderId,
    exchangeOrderId: "123",
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    status: "NEW",
    executedQuantity: new Decimal("0"),
    cumulativeQuoteQuantity: new Decimal("0"),
    fills: [],
    eventTimeMs: 1_500
  };
}

function createBus(overrides: Partial<RedisStreamClient> = {}): RedisStreamClient {
  return {
    xAdd: vi.fn(),
    xGroupCreate: vi.fn(async () => "OK"),
    xReadGroup: vi.fn(async () => null),
    xAck: vi.fn(async () => 1),
    xAutoClaim: vi.fn(async () => ({
      nextStartId: "0-0",
      messages: []
    })),
    ...overrides
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

  it("does not touch Redis or placement gateway during factory construction", () => {
    const execute = vi.fn();
    const queryOrder = vi.fn();
    const bus = createBus();
    const placeOrder = vi.fn();

    createExecutorRuntimeFromDeps({
      database: { execute },
      binanceClient: { queryOrder },
      logger: createLogger(),
      signalConsumer: {
        bus,
        exchange: { placeOrder },
        group: "executor",
        consumer: "executor-1",
        clientOrderIdPrefix: "mrd"
      }
    });

    expect(execute).not.toHaveBeenCalled();
    expect(queryOrder).not.toHaveBeenCalled();
    expect(bus.xGroupCreate).not.toHaveBeenCalled();
    expect(bus.xReadGroup).not.toHaveBeenCalled();
    expect(placeOrder).not.toHaveBeenCalled();
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

  it("prepares the configured signal consumer after startup reconciliation", async () => {
    const execute = vi.fn(async () => ({
      rowCount: 1,
      rows: []
    }));
    const queryOrder = vi.fn(async () => order);
    const bus = createBus();
    const runtime = createExecutorRuntimeFromDeps({
      database: { execute },
      binanceClient: { queryOrder },
      logger: createLogger(),
      signalConsumer: {
        bus,
        exchange: {
          placeOrder: vi.fn(async (request) => gatewayOrderResult(request.clientOrderId))
        },
        group: "executor",
        consumer: "executor-1",
        clientOrderIdPrefix: "mrd"
      }
    });

    await runtime.start();

    expect(bus.xGroupCreate).toHaveBeenCalledWith("signals", "executor", "0", {
      mkStream: true
    });
  });

  it("routes polled signal messages through write-ahead persistence and placement gateway", async () => {
    const signalValue = signal();
    const queries: SqlQuery[] = [];
    const execute = vi.fn(async (query: SqlQuery) => {
      queries.push(query);
      return { rowCount: 1, rows: [] };
    });
    const xReadGroup = vi.fn(async () => [
      {
        stream: "signals",
        messages: [
          {
            id: "1-0",
            fields: {
              kind: "signal",
              signalId: signalValue.signalId,
              payload: JSON.stringify(serializeSignal(signalValue))
            }
          }
        ]
      }
    ]);
    const bus = createBus({ xReadGroup });
    const placeOrder = vi.fn(async (request) => gatewayOrderResult(request.clientOrderId));
    const runtime = createExecutorRuntimeFromDeps({
      database: { execute },
      binanceClient: { queryOrder: vi.fn(async () => order) },
      logger: createLogger(),
      nowMs: () => 1_500,
      signalConsumer: {
        bus,
        exchange: { placeOrder },
        group: "executor",
        consumer: "executor-1",
        clientOrderIdPrefix: "mrd",
        readCount: 7,
        blockMs: 25
      }
    });

    const results = await runtime.pollSignalsOnce();

    expect(results).toMatchObject([
      {
        outcome: "submitted",
        signalId: "sig_1"
      }
    ]);
    expect(xReadGroup).toHaveBeenCalledWith(
      "executor",
      "executor-1",
      [{ key: "signals", id: ">" }],
      { count: 7, blockMs: 25 }
    );
    expect(normalizeSql(queries[0]?.text ?? "")).toContain("insert into orders");
    expect(queries[0]?.values).toEqual(
      expect.arrayContaining(["ema", "sig_1", "BTCUSDT", "BUY", "LIMIT", "0.0002", "83000.91"])
    );
    expect(placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        quantity: new Decimal("0.0002"),
        price: new Decimal("83000.91")
      })
    );
    expect(bus.xAck).toHaveBeenCalledWith("signals", "executor", "1-0");
  });

  it("wires Prometheus executor metrics into expired signal processing", async () => {
    const registry = new Registry();
    const expired = signal({
      signalId: "sig_expired",
      validUntilMs: 1_200
    });
    const bus = createBus({
      xReadGroup: vi.fn(async () => [
        {
          stream: "signals",
          messages: [
            {
              id: "4-0",
              fields: {
                kind: "signal",
                signalId: expired.signalId,
                payload: JSON.stringify(serializeSignal(expired))
              }
            }
          ]
        }
      ])
    });
    const runtime = createExecutorRuntimeFromDeps({
      database: {
        execute: vi.fn(async () => ({ rowCount: 1, rows: [] }))
      },
      binanceClient: { queryOrder: vi.fn(async () => order) },
      logger: createLogger(),
      metricsRegistry: registry,
      nowMs: () => 1_500,
      signalConsumer: {
        bus,
        exchange: {
          placeOrder: vi.fn(async (request) => gatewayOrderResult(request.clientOrderId))
        },
        group: "executor",
        consumer: "executor-1",
        clientOrderIdPrefix: "mrd"
      }
    });

    const results = await runtime.pollSignalsOnce();
    const output = await registry.metrics();

    expect(results).toEqual([
      {
        outcome: "expired",
        signalId: "sig_expired"
      }
    ]);
    expect(output).toContain(
      'signals_expired_total{strategyId="ema",symbol="BTCUSDT"} 1'
    );
    expect(bus.xAck).toHaveBeenCalledWith("signals", "executor", "4-0");
  });
});

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}
