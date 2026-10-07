import { describe, expect, it, vi } from "vitest";

import { createOrderWriteAheadRepository } from "./order-write-ahead-repository.js";
import type { SqlQuery } from "./migration-runner.js";

function createQueryRecorder() {
  const queries: SqlQuery[] = [];
  return {
    queries,
    execute: vi.fn(async (query: SqlQuery) => {
      queries.push(query);
    })
  };
}

describe("createOrderWriteAheadRepository", () => {
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
    expect(normalizeSql(db.queries[0]?.text ?? "")).toContain("on conflict (client_order_id) do nothing");
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
