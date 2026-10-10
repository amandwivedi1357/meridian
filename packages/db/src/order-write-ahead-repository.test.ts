import { describe, expect, it, vi } from "vitest";

import {
  createOrderWriteAheadRepository,
  type PendingOrderRecord
} from "./order-write-ahead-repository.js";
import type { SqlQuery } from "./migration-runner.js";

function createQueryRecorder() {
  const queries: SqlQuery[] = [];
  return {
    queries,
    execute: vi.fn(async (query: SqlQuery) => {
      queries.push(query);
      return { rowCount: 1 as number | null };
    })
  };
}

describe("createOrderWriteAheadRepository", () => {
  it.each([0, 1])(
    "allows submission only when an atomic claim updates one row (%s)",
    async (rowCount) => {
      const execute = vi.fn(async (query: SqlQuery) => {
        void query;
        return { rowCount };
      });
      expect(
        await createOrderWriteAheadRepository({ execute }).claimOrderSubmission("order-1")
      ).toBe(rowCount === 1);
      expect(normalizeSql(execute.mock.calls[0]![0]?.text ?? "")).toContain(
        "where client_order_id = $1 and state = 'pending_new'"
      );
    }
  );
  const record: PendingOrderRecord = {
    clientOrderId: "same-id",
    strategyId: "ema",
    signalId: "signal",
    attempt: 0,
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    quantity: "0.001",
    limitPrice: "100",
    createdAtMs: 1_000
  };

  it("reads submission state without mutation and checks immutable identity in SQL", async () => {
    const execute = vi.fn(async () => ({
      rowCount: 1,
      rows: [{ state: "UNKNOWN", identity_matches: true }]
    }));
    expect(await createOrderWriteAheadRepository({ execute }).getSubmissionState(record)).toBe(
      "UNKNOWN"
    );
    const query = (execute.mock.calls as unknown as [SqlQuery][])[0]![0];
    expect(normalizeSql(query.text)).toContain("select state");
    expect(normalizeSql(query.text)).toContain("limit_price is not distinct from $9::numeric");
    expect(query.values).toEqual([
      "same-id",
      "ema",
      "signal",
      0,
      "BTCUSDT",
      "BUY",
      "LIMIT",
      "0.001",
      "100"
    ]);
  });
  it("reports missing submission as unsent", async () => {
    expect(
      await createOrderWriteAheadRepository({
        execute: async () => ({ rowCount: 0, rows: [] })
      }).getSubmissionState(record)
    ).toBeNull();
  });
  it.each([
    { rowCount: 0 },
    { rowCount: 1, rows: [{ state: "UNKNOWN", identity_matches: false }] },
    { rowCount: 1, rows: [{ state: "bogus", identity_matches: true }] },
    { rowCount: 1, rows: [null] }
  ])("fails closed on unavailable or mismatched submission rows: %j", async (result) => {
    await expect(
      createOrderWriteAheadRepository({ execute: async () => result }).getSubmissionState(record)
    ).rejects.toThrow();
  });

  it("accepts an identical retry when the database confirms the identity", async () => {
    const db = createQueryRecorder();
    const repo = createOrderWriteAheadRepository(db);
    await repo.recordPendingOrder(record);
    await repo.recordPendingOrder({ ...record, createdAtMs: 2_000 });
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it.each([0, null])(
    "fails closed when the database reports %s matching rows",
    async (rowCount) => {
      const db = createQueryRecorder();
      db.execute.mockResolvedValue({ rowCount });
      await expect(createOrderWriteAheadRepository(db).recordPendingOrder(record)).rejects.toThrow(
        "Write-ahead order identity conflict"
      );
    }
  );

  it("propagates database failures instead of permitting submission", async () => {
    const db = createQueryRecorder();
    db.execute.mockRejectedValue(new Error("database unavailable"));
    await expect(createOrderWriteAheadRepository(db).recordPendingOrder(record)).rejects.toThrow(
      "database unavailable"
    );
  });
  it("inserts a pending order before exchange submission", async () => {
    const db = createQueryRecorder();
    const repo = createOrderWriteAheadRepository(db);

    await repo.recordPendingOrder({
      clientOrderId: "mrd_order_1",
      strategyId: "ema",
      signalId: "signal-1",
      attempt: 0,
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: "0.0002",
      limitPrice: "83000.91",
      createdAtMs: 1_704_067_200_000
    });

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(normalizeSql(db.queries[0]?.text ?? "")).toContain("insert into orders");
    const sql = normalizeSql(db.queries[0]?.text ?? "");
    expect(sql).toContain(
      "on conflict (client_order_id) do update set client_order_id = excluded.client_order_id"
    );
    for (const field of [
      "strategy_id",
      "signal_id",
      "attempt",
      "symbol",
      "side",
      "type",
      "quantity"
    ]) {
      expect(sql).toContain(`orders.${field} = excluded.${field}`);
    }
    expect(sql).toContain("orders.limit_price is not distinct from excluded.limit_price");
    expect(sql).not.toContain("set state");
    expect(db.queries[0]?.values).toEqual([
      "mrd_order_1",
      "ema",
      "signal-1",
      0,
      "BTCUSDT",
      "BUY",
      "LIMIT",
      "0.0002",
      "83000.91",
      "PENDING_NEW",
      new Date(1_704_067_200_000)
    ]);
  });

  it("omits limit price for market orders without writing undefined", async () => {
    const db = createQueryRecorder();
    const repo = createOrderWriteAheadRepository(db);

    await repo.recordPendingOrder({
      clientOrderId: "mrd_order_2",
      strategyId: "ema",
      signalId: "signal-2",
      attempt: 0,
      symbol: "BTCUSDT",
      side: "SELL",
      type: "MARKET",
      quantity: "0.0002",
      createdAtMs: 1_704_067_201_000
    });

    expect(db.queries[0]?.values[8]).toBeNull();
  });

  it("rejects unsafe records before writing", async () => {
    const db = createQueryRecorder();
    const repo = createOrderWriteAheadRepository(db);

    await expect(
      repo.recordPendingOrder({
        clientOrderId: "",
        strategyId: "ema",
        signalId: "signal-3",
        attempt: 0,
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        quantity: "0.0002",
        createdAtMs: 1_704_067_202_000
      })
    ).rejects.toThrow("clientOrderId is required");

    expect(db.execute).not.toHaveBeenCalled();
  });

  it("selects non-terminal local orders for reconciliation", async () => {
    const queries: SqlQuery[] = [];
    const repo = createOrderWriteAheadRepository({
      execute: vi.fn(async (query: SqlQuery) => {
        queries.push(query);
        return {
          rowCount: 2,
          rows: [
            {
              client_order_id: "pending",
              symbol: "BTCUSDT",
              state: "PENDING_NEW",
              updated_at_ms: "1704067200000"
            },
            {
              client_order_id: "unknown",
              symbol: "ETHUSDT",
              state: "UNKNOWN",
              updated_at_ms: "1704067205000"
            }
          ]
        };
      })
    });

    await expect(repo.listOrdersForReconciliation()).resolves.toEqual([
      {
        clientOrderId: "pending",
        symbol: "BTCUSDT",
        state: "PENDING_NEW",
        updatedAtMs: 1_704_067_200_000
      },
      {
        clientOrderId: "unknown",
        symbol: "ETHUSDT",
        state: "UNKNOWN",
        updatedAtMs: 1_704_067_205_000
      }
    ]);

    const sql = normalizeSql(queries[0]?.text ?? "");
    expect(sql).toContain("select client_order_id");
    expect(sql).toContain("from orders");
    expect(sql).toContain("where state in");
    expect(sql).toContain("pending_new");
    expect(sql).toContain("pending_cancel");
    expect(sql).toContain("unknown");
    expect(sql).toContain("partially_filled");
    expect(sql).not.toContain("'filled'");
    expect(sql).not.toContain("'canceled'");
    expect(sql).toContain("order by updated_at asc");
  });

  it("rejects malformed reconciliation rows from storage", async () => {
    const repo = createOrderWriteAheadRepository({
      execute: vi.fn(async () => ({
        rowCount: 1,
        rows: [
          {
            client_order_id: "bad",
            symbol: "btcusdt",
            state: "NEW",
            updated_at_ms: "1704067200000"
          }
        ]
      }))
    });

    await expect(repo.listOrdersForReconciliation()).rejects.toThrow(
      "Invalid order reconciliation row"
    );
  });

  it("marks non-terminal local orders terminal after exchange reconciliation", async () => {
    const db = createQueryRecorder();
    const repo = createOrderWriteAheadRepository(db);

    await repo.markOrderReconciledTerminal({
      clientOrderId: "mrd_order_1",
      terminalState: "FILLED",
      reconciledAtMs: 1_704_067_210_000
    });

    const sql = normalizeSql(db.queries[0]?.text ?? "");
    expect(sql).toContain("update orders");
    expect(sql).toContain("set state = $2");
    expect(sql).toContain("updated_at = $3");
    expect(sql).toContain("where client_order_id = $1");
    expect(sql).toContain("state in");
    expect(sql).toContain("pending_new");
    expect(sql).toContain("new");
    expect(sql).toContain("partially_filled");
    expect(sql).toContain("pending_cancel");
    expect(sql).toContain("unknown");
    expect(sql).not.toContain("'filled'");
    expect(sql).not.toContain("'canceled'");
    expect(db.queries[0]?.values).toEqual(["mrd_order_1", "FILLED", new Date(1_704_067_210_000)]);
  });

  it("rejects non-terminal reconciliation updates before writing", async () => {
    const db = createQueryRecorder();
    const repo = createOrderWriteAheadRepository(db);

    await expect(
      repo.markOrderReconciledTerminal({
        clientOrderId: "mrd_order_1",
        terminalState: "NEW" as never,
        reconciledAtMs: 1_704_067_210_000
      })
    ).rejects.toThrow("terminalState must be a terminal order state");

    expect(db.execute).not.toHaveBeenCalled();
  });

  it("records order execution updates with an out-of-order event guard", async () => {
    const db = createQueryRecorder();
    const repo = createOrderWriteAheadRepository(db);

    await repo.recordOrderExecutionUpdate({
      clientOrderId: "mrd_order_1",
      exchangeOrderId: "123",
      state: "PARTIALLY_FILLED",
      executedQuantity: "0.0001",
      cumulativeQuoteQuantity: "8.3",
      exchangeEventTimeMs: 1_704_067_230_000,
      executionId: "456"
    });

    const sql = normalizeSql(db.queries[0]?.text ?? "");
    expect(sql).toContain("update orders");
    expect(sql).toContain("set exchange_order_id = $2");
    expect(sql).toContain("state = $3");
    expect(sql).toContain("executed_quantity = $4");
    expect(sql).toContain("cumulative_quote_quantity = $5");
    expect(sql).toContain("last_exchange_event_time_ms = $6");
    expect(sql).toContain("last_execution_id = $7");
    expect(sql).toContain("where client_order_id = $1");
    expect(sql).toContain("last_exchange_event_time_ms <= $6");
    expect(db.queries[0]?.values).toEqual([
      "mrd_order_1",
      "123",
      "PARTIALLY_FILLED",
      "0.0001",
      "8.3",
      1_704_067_230_000,
      "456",
      new Date(1_704_067_230_000)
    ]);
  });

  it("records fee-aware trade fills idempotently by execution id", async () => {
    const db = createQueryRecorder();
    const repo = createOrderWriteAheadRepository(db);

    await repo.recordOrderExecutionUpdate({
      clientOrderId: "mrd_order_1",
      exchangeOrderId: "123",
      state: "FILLED",
      executedQuantity: "0.0002",
      cumulativeQuoteQuantity: "16.6",
      exchangeEventTimeMs: 1_704_067_231_000,
      executionId: "457",
      fill: {
        tradeId: "789",
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: "0.0001",
        price: "83000.91",
        fee: "0.000001",
        feeAsset: "BTC"
      }
    });

    expect(db.execute).toHaveBeenCalledTimes(2);
    const fillQuery = db.queries[1];
    const sql = normalizeSql(fillQuery?.text ?? "");
    expect(sql).toContain("insert into order_fills");
    expect(sql).toContain("on conflict (client_order_id, execution_id) do nothing");
    expect(fillQuery?.values).toEqual([
      "mrd_order_1",
      "457",
      "789",
      "BTCUSDT",
      "BUY",
      "0.0001",
      "83000.91",
      "0.000001",
      "BTC",
      1_704_067_231_000
    ]);
  });

  it("rejects invalid execution update decimals before writing", async () => {
    const db = createQueryRecorder();
    const repo = createOrderWriteAheadRepository(db);

    await expect(
      repo.recordOrderExecutionUpdate({
        clientOrderId: "mrd_order_1",
        exchangeOrderId: "123",
        state: "FILLED",
        executedQuantity: "NaN",
        cumulativeQuoteQuantity: "16.6",
        exchangeEventTimeMs: 1_704_067_231_000,
        executionId: "457"
      })
    ).rejects.toThrow("executedQuantity must be a non-negative decimal string");

    expect(db.execute).not.toHaveBeenCalled();
  });
});

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}
