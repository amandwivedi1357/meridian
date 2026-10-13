import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { Pool } from "pg";
import { it, expect } from "vitest";
import { registerApiAuth } from "../../app/auth.js";
import { registerManualOrderRoute } from "./manual-order.js";
import { registerCancelOrderRoute } from "./cancel-order.js";
it.skipIf(!process.env.API_TEST_DATABASE_URL)(
  "durable manual identities serialize concurrent API requests and cancellation retries recover",
  async () => {
    const schema = `order_retry_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: process.env.API_TEST_DATABASE_URL });
    const pool = new Pool({
      connectionString: process.env.API_TEST_DATABASE_URL,
      options: `-c search_path=${schema}`,
      max: 4
    });
    const operatorToken = "operator-token-123456789012345678",
      headers = { authorization: `Bearer ${operatorToken}` };
    const makeServer = () => {
      const app = Fastify();
      registerApiAuth(app, { operatorToken, viewerToken: "viewer-token-12345678901234567890" });
      return app;
    };
    const first = makeServer(),
      restarted = makeServer(),
      cancellation = makeServer();
    const payloads: string[] = [];
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      await pool.query(`CREATE TABLE audit_log(id bigint GENERATED ALWAYS AS IDENTITY,actor text,action text,details jsonb);
      CREATE TABLE orders(client_order_id text PRIMARY KEY,symbol text,state text,updated_at timestamptz,exchange_order_id text,executed_quantity numeric DEFAULT 0,cumulative_quote_quantity numeric DEFAULT 0,last_exchange_event_time_ms bigint DEFAULT 0,last_execution_id text);
      INSERT INTO orders(client_order_id,symbol,state) VALUES('fixture','BTCUSDT','NEW');`);
      const redis = {
        sendCommand: async (args: readonly string[]) => {
          payloads.push(args.at(-1)!);
          return `${payloads.length}-0`;
        }
      };
      registerManualOrderRoute(first, pool, redis);
      registerManualOrderRoute(restarted, pool, redis);
      const payload = {
        requestId: randomUUID(),
        symbol: "BTCUSDT",
        quantity: "0.0002",
        side: "BUY",
        type: "MARKET",
        reason: "isolated",
        confirm: "QUEUE_MANUAL_ORDER"
      };
      const responses = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          (i % 2 ? first : restarted).inject({
            method: "POST",
            url: "/api/orders/manual",
            headers,
            payload
          })
        )
      );
      expect(responses.every((r) => r.statusCode === 200)).toBe(true);
      expect(new Set(payloads).size).toBe(1);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM audit_log WHERE action='api-manual-order-requested'"
          )
        ).rows[0].n
      ).toBe(1);
      expect(
        (
          await restarted.inject({
            method: "POST",
            url: "/api/orders/manual",
            headers,
            payload: { ...payload, quantity: "0.001" }
          })
        ).statusCode
      ).toBe(409);
      let attempts = 0;
      const order = {
        symbol: "BTCUSDT",
        orderId: 1,
        orderListId: -1,
        clientOrderId: "fixture",
        origClientOrderId: "fixture",
        price: "100",
        origQty: "1",
        executedQty: "0",
        cummulativeQuoteQty: "0",
        status: "NEW" as const,
        timeInForce: "GTC" as const,
        type: "LIMIT" as const,
        side: "BUY" as const,
        updateTime: Date.now()
      };
      registerCancelOrderRoute(cancellation, pool, async () => ({
        queryOrder: async () => order,
        cancelOrder: async () => {
          if (++attempts === 1) throw new Error("pre-send failure");
          return { ...order, status: "CANCELED" as const };
        }
      }));
      const cancel = () =>
        cancellation.inject({
          method: "POST",
          url: "/api/orders/fixture/cancel",
          headers,
          payload: { reason: "isolated", confirm: "CANCEL_ORDER" }
        });
      expect((await cancel()).statusCode).toBe(503);
      expect((await cancel()).statusCode).toBe(200);
      expect(
        (await pool.query("SELECT state FROM orders WHERE client_order_id='fixture'")).rows[0].state
      ).toBe("CANCELED");
    } finally {
      await first.close();
      await restarted.close();
      await cancellation.close();
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  }
);
