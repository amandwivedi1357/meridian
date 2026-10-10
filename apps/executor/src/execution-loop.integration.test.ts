import { fork, type ChildProcess } from "node:child_process";
import { Pool } from "pg";
import { createClient } from "redis";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRedisStreamClient, ensureConsumerGroup, streams } from "@meridian/bus";
import { Decimal, serializeSignal, type Signal } from "@meridian/core";
import {
  createOrderWriteAheadRepository,
  createRiskRepository,
  marketDataMigrations,
  type RiskSqlDatabase
} from "@meridian/db";
import { processSignalMessage } from "./signal-execution.js";
import { createKillSwitch, KILL_SWITCH_KEY } from "./kill-switch.js";
import { handleUserDataOrderUpdate } from "./order-update-handler.js";

describe.skipIf(process.env.RUN_EXECUTION_INTEGRATION !== "1")(
  "disposable execution infrastructure",
  () => {
    let postgres: StartedTestContainer;
    let redisContainer: StartedTestContainer;
    let pool: Pool;
    let redis: ReturnType<typeof createClient>;
    let databaseUrl: string;
    let redisUrl: string;
    let db: RiskSqlDatabase;
    const children = new Set<ChildProcess>();
    beforeAll(async () => {
      postgres = await new GenericContainer("timescale/timescaledb:latest-pg16")
        .withEnvironment({
          POSTGRES_USER: "verification",
          POSTGRES_PASSWORD: "verification",
          POSTGRES_DB: "verification"
        })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage("database system is ready to accept connections", 2))
        .withStartupTimeout(120000)
        .start();
      redisContainer = await new GenericContainer("redis:7-alpine")
        .withExposedPorts(6379)
        .withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
        .start();
      databaseUrl = `postgres://verification:verification@${postgres.getHost()}:${postgres.getMappedPort(5432)}/verification`;
      redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
      pool = new Pool({ connectionString: databaseUrl });
      db = {
        async execute(query) {
          const result = await pool.query(query.text, [...query.values]);
          return { rows: result.rows, rowCount: result.rowCount };
        },
        async transaction(work) {
          const connection = await pool.connect();
          try {
            await connection.query("BEGIN");
            const result = await work({
              async execute(query) {
                const result = await connection.query(query.text, [...query.values]);
                return { rows: result.rows, rowCount: result.rowCount };
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
      for (const migration of marketDataMigrations) await pool.query(migration.sql);
      await pool.query(
        "CREATE TABLE simulated_exchange (client_order_id text PRIMARY KEY, symbol text NOT NULL, sends integer NOT NULL)"
      );
      redis = createClient({
        url: redisUrl,
        socket: { reconnectStrategy: false, connectTimeout: 1000 }
      });
      redis.on("error", () => {});
      await redis.connect();
    }, 240000);
    beforeEach(async () => {
      // Both connections belong only to containers created above, never application services.
      await pool.query("TRUNCATE orders, order_fills, simulated_exchange CASCADE");
      await pool.query("UPDATE risk_control_state SET engaged = false");
      await redis.sendCommand(["FLUSHDB"]);
      await redis.set(KILL_SWITCH_KEY, "0");
    });
    afterAll(async () => {
      for (const child of children) child.kill("SIGKILL");
      redis?.destroy();
      await pool?.end();
      await redisContainer?.stop();
      await postgres?.stop();
    }, 60000);
    function bus() {
      return createRedisStreamClient({ sendCommand: (args) => redis.sendCommand([...args]) });
    }
    function signal(): Signal {
      const now = Date.now();
      return {
        signalId: "integration",
        strategyId: "ema",
        createdAtMs: now,
        validUntilMs: now + 60000,
        intent: {
          symbol: "BTCUSDT",
          side: "BUY",
          type: "MARKET",
          quantity: new Decimal("0.0002"),
          reason: "verification"
        }
      };
    }
    async function publish() {
      await ensureConsumerGroup(bus(), streams.signals, "executor");
      await bus().xAdd(streams.signals, "*", {
        kind: "signal",
        payload: JSON.stringify(serializeSignal(signal()))
      });
    }
    async function launch(stage: string, nowMs?: number) {
      const child = fork(new URL("./testing/crash-worker.mjs", import.meta.url), [], {
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        execArgv: [],
        env: {
          ...process.env,
          CRASH_TEST_DATABASE_URL: databaseUrl,
          CRASH_TEST_REDIS_URL: redisUrl,
          CRASH_TEST_STAGE: stage,
          ...(nowMs === undefined ? {} : { CRASH_TEST_NOW_MS: String(nowMs) })
        }
      });
      children.add(child);
      let stderr = "";
      child.stderr?.on("data", (data) => {
        stderr += String(data);
      });
      const exited = new Promise<void>((resolve) =>
        child.once("exit", () => {
          children.delete(child);
          resolve();
        })
      );
      const report = await new Promise<{ stage: string; reason?: string }>((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`Worker timeout: ${stderr}`));
        }, 15000);
        child.once("message", (message) => {
          clearTimeout(timer);
          resolve(message as { stage: string; reason?: string });
        });
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`Worker exited ${code}: ${stderr}`));
        });
      });
      return { child, report, exited };
    }
    it("consumes a real stream signal and stores an idempotent fee-aware simulated fill", async () => {
      await publish();
      const message = (await bus().xReadGroup("executor", "fill-test", [
        { key: streams.signals, id: ">" }
      ]))![0]!.messages[0]!;
      const store = createOrderWriteAheadRepository(db);
      const result = await processSignalMessage(message, {
        bus: bus(),
        group: "executor",
        store,
        exchange: { placeOrder: vi.fn() },
        clientOrderIdPrefix: "test",
        nowMs: Date.now,
        riskGate: { evaluate: async () => ({ approved: true }) }
      });
      if (result.outcome !== "submitted") throw new Error("Signal was not submitted");
      const now = Date.now();
      const update = {
        kind: "order-update" as const,
        subscriptionId: 1,
        eventTimeMs: now,
        transactionTimeMs: now,
        symbol: "BTCUSDT",
        clientOrderId: result.clientOrderId,
        originalClientOrderId: undefined,
        orderId: "123",
        executionId: "456",
        tradeId: "789",
        side: "BUY" as const,
        type: "MARKET" as const,
        status: "FILLED" as const,
        executionType: "TRADE" as const,
        quantity: new Decimal("0.0002"),
        price: new Decimal("83000"),
        lastQuantity: new Decimal("0.0002"),
        lastPrice: new Decimal("83000"),
        executedQuantity: new Decimal("0.0002"),
        cumulativeQuoteQuantity: new Decimal("16.6"),
        commission: new Decimal("0.0166"),
        commissionAsset: "USDT",
        maker: false
      };
      await handleUserDataOrderUpdate(update, { store });
      await handleUserDataOrderUpdate(update, { store });
      expect((await pool.query("SELECT state FROM orders")).rows).toEqual([{ state: "FILLED" }]);
      expect((await pool.query("SELECT fee::text, fee_asset FROM order_fills")).rows).toEqual([
        { fee: "0.0166", fee_asset: "USDT" }
      ]);
      expect(
        ((await redis.sendCommand(["XPENDING", streams.signals, "executor"])) as unknown[])[0]
      ).toBe(0);
    });
    it.each(["persisted-before-claim", "sent-before-ack"])(
      "recovers after process death at %s without duplicate placement",
      async (stage) => {
        await publish();
        const original = await launch(stage);
        expect(original.report.stage).toBe(stage);
        original.child.kill("SIGKILL");
        await original.exited;
        const recovered = await launch("recover");
        expect(recovered.report.stage).toBe("completed");
        await recovered.exited;
        expect((await pool.query("SELECT sends FROM simulated_exchange")).rows).toEqual([
          { sends: 1 }
        ]);
        expect(
          ((await redis.sendCommand(["XPENDING", streams.signals, "executor"])) as unknown[])[0]
        ).toBe(0);
      },
      30000
    );
    it("retains claim-before-send ambiguity without a blind resend or ACK", async () => {
      await publish();
      const original = await launch("claimed-before-send");
      original.child.kill("SIGKILL");
      await original.exited;
      const recovered = await launch("recover");
      expect(recovered.report).toMatchObject({
        stage: "blocked",
        reason: "Order submission is ambiguous; reconciliation required"
      });
      await recovered.exited;
      expect((await pool.query("SELECT * FROM simulated_exchange")).rows).toHaveLength(0);
      expect((await pool.query("SELECT state FROM orders")).rows).toEqual([{ state: "UNKNOWN" }]);
      expect(
        ((await redis.sendCommand(["XPENDING", streams.signals, "executor"])) as unknown[])[0]
      ).toBe(1);
    }, 30000);
    it.each(["sent-before-ack", "claimed-before-send"])(
      "recovers expired %s without losing uncertainty or duplicating placement",
      async (stage) => {
        await publish();
        const original = await launch(stage);
        original.child.kill("SIGKILL");
        await original.exited;
        const recovered = await launch("recover", Date.now() + 120000);
        expect(recovered.report.stage).toBe(stage === "sent-before-ack" ? "completed" : "blocked");
        await recovered.exited;
        expect((await pool.query("SELECT sends FROM simulated_exchange")).rows).toEqual(
          stage === "sent-before-ack" ? [{ sends: 1 }] : []
        );
        expect(
          ((await redis.sendCommand(["XPENDING", streams.signals, "executor"])) as unknown[])[0]
        ).toBe(stage === "sent-before-ack" ? 0 : 1);
      },
      30000
    );
    it("does not place or ACK when the actual write-ahead insert fails", async () => {
      await publish();
      const message = (await bus().xReadGroup("executor", "test", [
        { key: streams.signals, id: ">" }
      ]))![0]!.messages[0]!;
      await pool.query(
        "CREATE FUNCTION reject_order() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'write-ahead unavailable'; END $$"
      );
      await pool.query(
        "CREATE TRIGGER reject_order BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION reject_order()"
      );
      const placeOrder = vi.fn();
      try {
        await expect(
          processSignalMessage(message, {
            bus: bus(),
            group: "executor",
            store: createOrderWriteAheadRepository(db),
            exchange: { placeOrder },
            clientOrderIdPrefix: "test",
            nowMs: Date.now,
            riskGate: { evaluate: async () => ({ approved: true }) }
          })
        ).rejects.toThrow("write-ahead unavailable");
        expect(placeOrder).not.toHaveBeenCalled();
        expect(
          ((await redis.sendCommand(["XPENDING", streams.signals, "executor"])) as unknown[])[0]
        ).toBe(1);
      } finally {
        await pool.query("DROP TRIGGER reject_order ON orders");
        await pool.query("DROP FUNCTION reject_order()");
      }
    });
    it("latches, cancels and alerts after stopping only the disposable Redis", async () => {
      const repo = createRiskRepository(db);
      const alert = vi.fn();
      const cancelOrder = vi.fn();
      const kill = createKillSwitch({
        repo,
        command: (args) => redis.sendCommand([...args]),
        alert,
        cancelOrder,
        listOpenOrders: async () => [{ symbol: "BTCUSDT", clientOrderId: "test-open" }],
        timeoutMs: 250
      });
      expect(await kill.check()).toBe(false);
      await redisContainer.stop({ remove: false });
      const started = Date.now();
      await expect(kill.assertSafe()).rejects.toThrow();
      const placeOrder = vi.fn();
      await expect(
        processSignalMessage(
          {
            id: "1-0",
            fields: { kind: "signal", payload: JSON.stringify(serializeSignal(signal())) }
          },
          {
            bus: bus(),
            group: "executor",
            store: createOrderWriteAheadRepository(db),
            exchange: { placeOrder },
            clientOrderIdPrefix: "test",
            nowMs: Date.now,
            riskGate: {
              async evaluate() {
                await kill.assertSafe();
                return { approved: true };
              }
            }
          }
        )
      ).rejects.toThrow();
      expect(placeOrder).not.toHaveBeenCalled();
      expect(Date.now() - started).toBeLessThan(5000);
      expect((await repo.getKillState()).engaged).toBe(true);
      expect(cancelOrder).toHaveBeenCalledWith({ symbol: "BTCUSDT", clientOrderId: "test-open" });
      expect(alert).toHaveBeenCalled();
    }, 30000);
  }
);
