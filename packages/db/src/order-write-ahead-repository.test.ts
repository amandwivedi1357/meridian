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
});

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}
