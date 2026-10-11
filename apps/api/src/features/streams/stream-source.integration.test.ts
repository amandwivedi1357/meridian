import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { Pool } from "pg";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { marketDataMigrations } from "@meridian/db";
import { marketEventProtobufCodec, marketEventJsonCodec } from "@meridian/proto";
import { createStreamSource, type StreamSource, type StreamTopic } from "./stream-source.js";
import { configureGateway } from "../../app/gateway.js";
import { registerApiAuth } from "../../app/auth.js";
import { registerSessions } from "../../app/session.js";
import { createPortfolioReader } from "../account/portfolio.js";
import { valueWallet } from "../account/wallet.js";
import { Decimal } from "@meridian/core";

describe.skipIf(!process.env.API_TEST_DATABASE_URL || !process.env.API_TEST_REDIS_URL)(
  "isolated gateway infrastructure",
  () => {
    const namespace = `api_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: process.env.API_TEST_DATABASE_URL });
    const pool = new Pool({
      connectionString: process.env.API_TEST_DATABASE_URL,
      options: `-c search_path=${namespace}`
    });
    const redis = new Redis(process.env.API_TEST_REDIS_URL!);
    const options = { namespace, marketPrefix: `${namespace}:` };
    const market: StreamTopic = { kind: "market", symbol: "BTCUSDT", interval: "15m" };
    const account: StreamTopic = { ...market, kind: "account" };
    let source: StreamSource;
    beforeAll(async () => {
      await admin.query(`CREATE SCHEMA ${namespace}`);
      for (const migration of marketDataMigrations.slice(2, 7)) await pool.query(migration.sql);
      source = createStreamSource(process.env.API_TEST_REDIS_URL!, pool, options);
    });
    afterAll(async () => {
      await source?.close();
      // Delete only exact test-owned keys, never application streams or limiter buckets.
      const own = await redis.keys(`${namespace}*`);
      if (own.length) await redis.del(...own);
      redis.disconnect();
      await pool.end();
      try {
        await admin.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
      } finally {
        await admin.end();
      }
    });
    it("decodes real Redis protobuf/JSON entries and resumes across source restart", async () => {
      const cursor = await source.open(market);
      const event = marketEventJsonCodec.decode(
        Buffer.from(
          JSON.stringify({
            kind: "trade",
            symbol: "BTCUSDT",
            eventId: "1",
            occurredAtMs: 1,
            trade: {
              symbol: "BTCUSDT",
              tradeId: "1",
              price: "80000.00000001",
              quantity: "0.0002",
              eventTimeMs: 1,
              isBuyerMaker: false
            }
          })
        )
      );
      const key = `${namespace}:market.trade.BTCUSDT`;
      await redis.xadd(key, "*", "payload", Buffer.from(marketEventProtobufCodec.encode(event)));
      const first = await source.read(market, cursor);
      expect(first.events).toHaveLength(1);
      expect(JSON.parse(JSON.stringify(first.events))[0].trade.price).toBe("80000.00000001");
      await source.close();
      source = createStreamSource(process.env.API_TEST_REDIS_URL!, pool, options);
      await source.open(market, first.cursor);
      await redis.xadd(
        key,
        "*",
        "payload",
        Buffer.from(marketEventJsonCodec.encode({ ...event, eventId: "2" }))
      );
      expect((await source.read(market, first.cursor)).events).toHaveLength(1);
      await redis.del(key);
      await expect(source.open(market, first.cursor)).rejects.toThrow("resync");
    });
    it("accepts 500 simultaneous market/account opens on a cold Redis connection", async () => {
      const cold = createStreamSource(process.env.API_TEST_REDIS_URL!, pool, {
        namespace: `${namespace}:cold`,
        marketPrefix: `${namespace}:cold:`
      });
      try {
        const cursors = await Promise.all(
          Array.from({ length: 500 }, (_, index) => cold.open(index % 2 ? account : market))
        );
        expect(cursors).toHaveLength(500);
        expect(cursors.every((cursor) => cursor.startsWith("v1."))).toBe(true);
      } finally {
        await cold.close();
      }
    });
    it("timestamps control snapshots independently from cached portfolio observations", async () => {
      const controlSource = createStreamSource(process.env.API_TEST_REDIS_URL!, pool, {
        ...options,
        namespace: `${namespace}:control-time`,
        portfolio: async () => ({
          checkedAt: 1,
          scope: "persisted-fills",
          accounting: "weighted-average",
          environment: "testnet",
          equity: null,
          equityReason: "fixture",
          status: "available",
          positions: [],
          totals: []
        })
      });
      try {
        await pool.query(
          "INSERT INTO strategy_control_state(strategy_id,paused,reason) VALUES ('timestamp-fixture',false,'initial')"
        );
        const cursor = await controlSource.open(account);
        const first = await controlSource.read(account, cursor);
        const previous = first.events[0] as { checkedAt: number; portfolio: { checkedAt: number } };
        expect(previous.checkedAt).toBeGreaterThan(1);
        expect(previous.portfolio.checkedAt).toBe(1);
        await pool.query(
          "UPDATE strategy_control_state SET paused=true,reason='changed' WHERE strategy_id='timestamp-fixture'"
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
        const changed = await controlSource.read(account, first.cursor);
        expect(changed.events).toHaveLength(1);
        const observation = changed.events[0] as {
          checkedAt: number;
          strategies: { strategyId: string; paused: boolean }[];
        };
        expect(observation.checkedAt).toBeGreaterThan(previous.checkedAt);
        expect(observation.strategies).toContainEqual(
          expect.objectContaining({ strategyId: "timestamp-fixture", paused: true })
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect((await controlSource.read(account, changed.cursor)).events).toHaveLength(0);
      } finally {
        await controlSource.close();
        await pool.query(
          "DELETE FROM strategy_control_state WHERE strategy_id='timestamp-fixture'"
        );
      }
    });
    it("persists account snapshots only on change and resumes their Redis history", async () => {
      const start = await source.open(account);
      const first = await source.read(account, start);
      expect(first.events).toHaveLength(1);
      expect(first.events[0]).toMatchObject({
        kind: "account-snapshot",
        orders: [],
        fills: [],
        historyLimit: 100
      });
      expect((await source.read(account, first.cursor)).events).toHaveLength(0);
      await pool.query(
        "INSERT INTO strategy_control_state (strategy_id,paused,reason) VALUES ('test',true,'test')"
      );
      await new Promise((resolve) => setTimeout(resolve, 260));
      const changed = await source.read(account, first.cursor);
      expect(changed.events).toHaveLength(1);
      expect(changed.events[0]).toMatchObject({
        strategies: [{ strategyId: "test", paused: true }]
      });
      await source.close();
      source = createStreamSource(process.env.API_TEST_REDIS_URL!, pool, options);
      await source.open(account, first.cursor);
      expect((await source.read(account, first.cursor)).events).toHaveLength(1);
    });
    it("requires resync when a depth diff is absent between pre-overflow and recovered batches", async () => {
      const topic: StreamTopic = { kind: "market", symbol: "ETHUSDT", interval: "15m" };
      const start = await source.open(topic);
      const key = `${namespace}:market.book.ETHUSDT`;
      const delta = (id: number) =>
        JSON.stringify({
          kind: "depth",
          symbol: "ETHUSDT",
          eventId: String(id),
          occurredAtMs: 1,
          depth: { firstUpdateId: id, finalUpdateId: id, bids: [], asks: [] }
        });
      await redis.xadd(key, "*", "payload", delta(1000));
      const first = await source.read(topic, start);
      expect(first.events).toHaveLength(1);
      await redis.xadd(key, "*", "payload", delta(1002));
      await expect(source.read(topic, first.cursor)).rejects.toThrow("book_gap");
    });
    it("bounds account replay history and requires resync after an old cursor is trimmed", async () => {
      const feed = createStreamSource(process.env.API_TEST_REDIS_URL!, pool, {
        ...options,
        namespace: `${namespace}:retention`
      });
      let time = Date.now();
      const clock = vi.spyOn(Date, "now").mockImplementation(() => time);
      try {
        const initial = await feed.open(account);
        const first = await feed.read(account, initial);
        const history = redis.pipeline();
        for (let i = 0; i < 130; i++)
          history.xadd(
            `${namespace}:retention:account-events`,
            "*",
            "payload",
            JSON.stringify(first.events[0])
          );
        await history.exec();
        time += 300;
        await pool.query(
          "INSERT INTO strategy_control_state(strategy_id,paused,reason) VALUES($1,true,$2) ON CONFLICT(strategy_id) DO UPDATE SET reason=EXCLUDED.reason",
          [namespace, "trim-history"]
        );
        await feed.open(account);
        expect(await redis.xlen(`${namespace}:retention:account-events`)).toBe(128);
        await expect(feed.open(account, first.cursor)).rejects.toThrow("cursor_expired");
      } finally {
        clock.mockRestore();
        await feed.close();
        await pool.query("DELETE FROM strategy_control_state WHERE strategy_id=$1", [namespace]);
      }
    });
    it("captures fresh market history with an exact checkpoint and rejects stale books", async () => {
      const topic: StreamTopic = { kind: "market", symbol: "BNBUSDT", interval: "15m" };
      const feed = createStreamSource(process.env.API_TEST_REDIS_URL!, pool, options);
      const key = `${namespace}:market.book.BNBUSDT`;
      const delta = (time: number) =>
        JSON.stringify({
          kind: "depth",
          symbol: "BNBUSDT",
          eventId: "1",
          occurredAtMs: time,
          depth: { firstUpdateId: 1, finalUpdateId: 1, bids: [], asks: [] }
        });
      try {
        await expect(feed.captureMarket(topic)).rejects.toThrow("stale");
        await redis.xadd(key, "*", "payload", delta(Date.now() - 16000));
        await expect(feed.captureMarket(topic)).rejects.toThrow("stale");
        await redis.xadd(key, "*", "payload", delta(Date.now()));
        const captured = await feed.captureMarket(topic);
        await expect(feed.open(topic, captured.cursor)).resolves.toBe(captured.cursor);
        expect((await feed.read(topic, captured.cursor)).events).toEqual([]);
      } finally {
        await feed.close();
      }
    });
    it("replays real PostgreSQL fees into the persisted account SSE payload", async () => {
      const ownOrder = `${namespace}_portfolio_order`;
      const portfolio = createPortfolioReader(
        pool,
        {
          metadata: async () => [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" }],
          mark: async () => ({ price: "130", observedAtMs: Date.now() })
        },
        "testnet",
        Date.now,
        async (positions) =>
          valueWallet(
            {
              observedAtMs: Date.now(),
              balances: [
                { asset: "BTC", free: new Decimal(1), locked: new Decimal(0) },
                { asset: "USDT", free: new Decimal(100), locked: new Decimal(0) }
              ],
              metadata: [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" }],
              tickers: [{ symbol: "BTCUSDT", bidPrice: "130", askPrice: "130" }]
            },
            positions
          )
      );
      const feed = createStreamSource(process.env.API_TEST_REDIS_URL!, pool, {
        ...options,
        namespace: `${namespace}:portfolio`,
        portfolio
      });
      try {
        await pool.query(
          `INSERT INTO orders (client_order_id,strategy_id,signal_id,attempt,symbol,side,type,quantity,state)
          VALUES ($1,'portfolio','portfolio',0,'BTCUSDT','BUY','LIMIT',2,'FILLED')`,
          [ownOrder]
        );
        await pool.query(
          `INSERT INTO order_fills (client_order_id,execution_id,trade_id,symbol,side,quantity,price,fee,fee_asset,event_time_ms)
          VALUES ($1,'buy','1','BTCUSDT','BUY',2,100,2,'USDT',1),
          ($1,'sell','2','BTCUSDT','SELL',1,120,1,'USDT',2)`,
          [ownOrder]
        );
        const cursor = await feed.open(account);
        const batch = await feed.read(account, cursor);
        expect(batch.events[0]).toMatchObject({
          portfolio: {
            scope: "persisted-fills",
            equity: "230",
            equityScope: "exchange-wallet",
            wallet: { reconciliation: "matched", equity: "230" },
            positions: [{ quantity: "1", costBasis: "101", realizedPnl: "18", unrealizedPnl: "29" }]
          }
        });
      } finally {
        await feed.close();
        await pool.query("DELETE FROM orders WHERE client_order_id=$1", [ownOrder]);
      }
    });
    it("retains global request limits across API instance restart", async () => {
      for (let instance = 0; instance < 2; instance++) {
        const app = Fastify();
        await configureGateway(app, process.env.API_TEST_REDIS_URL!, {
          namespace: `${namespace}:global:`,
          maxRequests: 2
        });
        registerApiAuth(app, {});
        app.get("/health/live", async () => ({ status: "ok" }));
        try {
          if (instance === 0)
            for (let i = 0; i < 2; i++)
              expect((await app.inject({ url: "/api/openapi.json" })).statusCode).toBe(200);
          expect((await app.inject({ url: "/api/openapi.json" })).statusCode).toBe(429);
          expect((await app.inject({ url: "/health/live" })).statusCode).toBe(200);
        } finally {
          await app.close();
        }
      }
    });
    it("generates protected OpenAPI docs and enforces Redis-backed login limits", async () => {
      const server = Fastify();
      await configureGateway(server, process.env.API_TEST_REDIS_URL!, {
        namespace: `${namespace}:rate:`,
        maxRequests: 100
      });
      const viewerToken = "v".repeat(40);
      const config = { viewerToken, jwtSecret: "s".repeat(40) };
      registerApiAuth(server, config);
      await registerSessions(server, config);
      try {
        expect((await server.inject({ url: "/api/openapi.json" })).statusCode).toBe(401);
        const docs = await server.inject({
          url: "/api/openapi.json",
          headers: { authorization: `Bearer ${viewerToken}` }
        });
        expect(docs.statusCode).toBe(200);
        expect(docs.json().paths["/api/auth/login"].post.requestBody).toBeDefined();
        for (let i = 0; i < 5; i++)
          expect(
            (
              await server.inject({
                method: "POST",
                url: "/api/auth/login",
                payload: { token: "x".repeat(40) }
              })
            ).statusCode
          ).toBe(401);
        const limited = await server.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { token: viewerToken }
        });
        expect(limited.statusCode).toBe(429);
        expect(limited.headers["retry-after"]).toBeDefined();
      } finally {
        await server.close();
      }
    });
  }
);
