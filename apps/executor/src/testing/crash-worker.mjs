import { Pool } from "pg";
import { createClient } from "redis";
import { createRedisStreamClient, streams } from "@meridian/bus";
import { createOrderWriteAheadRepository } from "@meridian/db";
import { processSignalMessage } from "../../dist/signal-execution.js";

// Test-only exchange ledger: no Binance client or credentials are used.
const pool = new Pool({ connectionString: process.env.CRASH_TEST_DATABASE_URL });
const redis = createClient({ url: process.env.CRASH_TEST_REDIS_URL });
redis.on("error", () => {});
const stage = process.env.CRASH_TEST_STAGE;
async function checkpoint(name) {
  if (stage !== name) return;
  process.send({ stage: name });
  await new Promise(() => {});
}
try {
  await redis.connect();
  const bus = createRedisStreamClient({ sendCommand: (args) => redis.sendCommand([...args]) });
  const store = createOrderWriteAheadRepository({
    async execute(query) {
      const result = await pool.query(query.text, [...query.values]);
      return { rows: result.rows, rowCount: result.rowCount };
    }
  });
  const message =
    stage === "recover"
      ? (await bus.xAutoClaim(streams.signals, "executor", "recovered", 0, "0-0")).messages[0]
      : (await bus.xReadGroup("executor", "original", [{ key: streams.signals, id: ">" }]))?.[0]
          ?.messages[0];
  if (!message) throw new Error("Test signal missing");
  await processSignalMessage(message, {
    group: "executor",
    clientOrderIdPrefix: "test",
    nowMs: Date.now,
    riskGate: { evaluate: async () => ({ approved: true }) },
    bus: {
      async xAck(...args) {
        await checkpoint("sent-before-ack");
        return bus.xAck(...args);
      }
    },
    store: {
      async recordPendingOrder(record) {
        await store.recordPendingOrder(record);
        await checkpoint("persisted-before-claim");
      },
      async claimOrderSubmission(id) {
        const claimed = await store.claimOrderSubmission(id);
        await checkpoint("claimed-before-send");
        return claimed;
      }
    },
    exchange: {
      async placeOrder(request) {
        await pool.query(
          `INSERT INTO simulated_exchange (client_order_id, symbol, sends)
          VALUES ($1, $2, 1) ON CONFLICT (client_order_id)
          DO UPDATE SET sends = simulated_exchange.sends + 1`,
          [request.clientOrderId, request.symbol]
        );
      },
      async getOrder(request) {
        const result = await pool.query(
          "SELECT client_order_id, symbol FROM simulated_exchange WHERE client_order_id = $1",
          [request.clientOrderId]
        );
        const row = result.rows[0];
        return row ? { clientOrderId: row.client_order_id, symbol: row.symbol } : null;
      }
    }
  });
  process.send({ stage: "completed" });
} catch (error) {
  process.send({ stage: "blocked", reason: error.message });
  process.exitCode = 2;
} finally {
  redis.destroy();
  await pool.end();
}
