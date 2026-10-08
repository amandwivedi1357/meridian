import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRiskRepository, marketDataMigrations, type RiskSqlDatabase } from "@meridian/db";

// Opt-in local database verification; never touches the application's schema or Redis keys.
describe.skipIf(!process.env.RISK_TEST_DATABASE_URL)("isolated PostgreSQL risk storage", () => {
  const schema = `risk_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: process.env.RISK_TEST_DATABASE_URL });
  const pool = new Pool({
    connectionString: process.env.RISK_TEST_DATABASE_URL,
    options: `-c search_path=${schema}`,
    max: 4
  });
  const db: RiskSqlDatabase = {
    async execute(query) {
      const r = await pool.query(query.text, [...query.values]);
      return { rows: r.rows, rowCount: r.rowCount };
    },
    async transaction(work) {
      const connection = await pool.connect();
      try {
        await connection.query("BEGIN");
        const result = await work({
          async execute(query) {
            const r = await connection.query(query.text, [...query.values]);
            return { rows: r.rows, rowCount: r.rowCount };
          }
        });
        await connection.query("COMMIT");
        return result;
      } catch (error) {
        await connection.query("ROLLBACK");
        throw error;
      } finally {
        connection.release();
      }
    }
  };
  const repo = createRiskRepository(db);
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    for (const migration of marketDataMigrations.slice(2)) await pool.query(migration.sql);
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE risk_reservations, risk_events, audit_log, risk_equity_state");
  });
  afterAll(async () => {
    await pool.end();
    try {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await admin.end();
    }
  });
  it("starts engaged and atomically audits an explicit reset", async () => {
    expect((await repo.getKillState()).engaged).toBe(true);
    await repo.locked(async (tx) => {
      await tx.setKillState(false, "authenticated-reset", "test-operator");
    });
    expect((await repo.getKillState()).engaged).toBe(false);
    expect((await pool.query("SELECT actor, action FROM audit_log")).rows).toEqual([
      { actor: "test-operator", action: "kill-switch-reset" }
    ]);
  });
  it("rolls back state, audit and risk events together on failure", async () => {
    await expect(
      repo.locked(async (tx) => {
        await tx.setKillState(true, "breaker", "risk-test");
        await tx.recordEvent("breaker", { reason: "test" });
        throw new Error("simulated failure");
      })
    ).rejects.toThrow("simulated failure");
    expect((await repo.getKillState()).engaged).toBe(false);
    expect((await pool.query("SELECT * FROM audit_log")).rows).toHaveLength(0);
    expect((await pool.query("SELECT * FROM risk_events")).rows).toHaveLength(0);
  });
  it("serializes concurrent sliding-window approvals across separate pool connections", async () => {
    const approve = (signalId: string) =>
      repo.locked(async (tx) => {
        if ((await tx.countRecentReservations("ema", 100000)) >= 1) return false;
        await tx.reserve({
          signalId,
          strategyId: "ema",
          symbol: "BTCUSDT",
          side: "BUY",
          quantity: "0.0002",
          notional: "16.6",
          reservedAtMs: 100000,
          validUntilMs: 105000
        });
        return true;
      });
    expect((await Promise.all([approve("a"), approve("b")])).sort()).toEqual([false, true]);
    expect(await repo.countRecentReservations("ema", 100000)).toBe(1);
    expect(await repo.countRecentReservations("ema", 160000)).toBe(0);
  });
  it("persists the equity peak across repository recreation", async () => {
    expect(await repo.updatePeak("1000")).toBe("1000");
    expect(await createRiskRepository(db).updatePeak("900")).toBe("1000");
    await expect(repo.updatePeak("1000", "USDC")).rejects.toThrow("Equity peak unavailable");
  });
  it("retains an expired reservation while its submission is UNKNOWN", async () => {
    await repo.reserve({
      signalId: "uncertain",
      strategyId: "ema",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.0002",
      notional: "16.6",
      reservedAtMs: 1,
      validUntilMs: 2
    });
    await pool.query(`INSERT INTO orders (client_order_id, strategy_id, signal_id, attempt, symbol, side, type, quantity, state)
      VALUES ('risk-test-order','ema','uncertain',0,'BTCUSDT','BUY','MARKET',0.0002,'UNKNOWN')`);
    expect(await repo.listActiveReservations(100000)).toHaveLength(1);
    await pool.query(
      "UPDATE orders SET state = 'CANCELED' WHERE client_order_id = 'risk-test-order'"
    );
    expect(await repo.listActiveReservations(100000)).toHaveLength(0);
  });
});
