import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { Pool } from "pg";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { marketDataMigrations } from "@meridian/db";
import { configureGateway } from "./gateway.js";
import { registerApiAuth } from "./auth.js";
import { registerSessions } from "./session.js";
import { registerRiskControlRoutes } from "../features/risk/risk-control.js";
import { registerStrategyControlRoutes } from "../features/strategies/strategy-control.js";
import { registerMarketCandlesRoutes } from "../features/market/candles.js";

describe.skipIf(!process.env.API_TEST_DATABASE_URL || !process.env.API_TEST_REDIS_URL)(
  "isolated API controls and audit atomicity",
  () => {
    const namespace = `control_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: process.env.API_TEST_DATABASE_URL });
    const pool = new Pool({
      connectionString: process.env.API_TEST_DATABASE_URL,
      options: `-c search_path=${namespace}`
    });
    const redis = new Redis(process.env.API_TEST_REDIS_URL!);
    const server = Fastify();
    const origin = "http://localhost:5173";
    const config = {
      viewerToken: "v".repeat(40),
      operatorToken: "o".repeat(40),
      jwtSecret: "s".repeat(40),
      allowedOrigins: [origin]
    };
    let viewerCookie = "",
      operatorCookie = "",
      failRedis = false;
    beforeAll(async () => {
      await admin.query(`CREATE SCHEMA ${namespace}`);
      for (const migration of marketDataMigrations.slice(2, 7)) await pool.query(migration.sql);
      await pool.query(`CREATE FUNCTION reject_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.details->>'reason'='reject-audit' THEN RAISE EXCEPTION 'test audit unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_test_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_test_audit();
      CREATE FUNCTION reject_test_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.details->>'reason'='reject-event' THEN RAISE EXCEPTION 'test risk event unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_test_event BEFORE INSERT ON risk_events FOR EACH ROW EXECUTE FUNCTION reject_test_event();`);
      await configureGateway(server, process.env.API_TEST_REDIS_URL!, {
        namespace: `${namespace}:rate:`,
        maxRequests: 100
      });
      registerApiAuth(server, config);
      await registerSessions(server, config);
      registerStrategyControlRoutes(server, pool);
      registerMarketCandlesRoutes(server, pool);
      registerRiskControlRoutes(server, pool, {
        async sendCommand(args) {
          // Exercise real Redis but never touch the application kill-switch key.
          if (args.join(" ") !== "SET meridian:risk:kill-switch 1")
            throw new Error("unexpected command");
          if (failRedis) throw new Error("test Redis unavailable");
          return redis.set(`${namespace}:kill-switch`, "1");
        }
      });
      for (const role of ["viewer", "operator"] as const) {
        const login = await server.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { token: config[role === "viewer" ? "viewerToken" : "operatorToken"] }
        });
        expect(login.statusCode).toBe(200);
        const cookie = login.cookies[0]!;
        if (role === "viewer") viewerCookie = `${cookie.name}=${cookie.value}`;
        else operatorCookie = `${cookie.name}=${cookie.value}`;
      }
    });
    afterAll(async () => {
      await server.close();
      const keys = await redis.keys(`${namespace}:*`);
      if (keys.length) await redis.del(...keys);
      redis.disconnect();
      await pool.end();
      try {
        await admin.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
      } finally {
        await admin.end();
      }
    });
    const post = (path: string, reason: string, cookie = operatorCookie, confirm?: string) =>
      server.inject({
        method: "POST",
        url: path,
        headers: { cookie, origin },
        payload: { reason, ...(confirm ? { confirm } : {}) }
      });
    it("rejects JWT viewers and cookie writes without an allowed origin before persistence", async () => {
      for (const path of [
        "/api/strategies/ema/pause",
        "/api/strategies/ema/resume",
        "/api/risk/kill-switch/engage"
      ]) {
        expect(
          (
            await post(
              path,
              "denied",
              viewerCookie,
              path.endsWith("/resume") ? "RESUME_STRATEGY" : undefined
            )
          ).statusCode
        ).toBe(403);
      }
      const denied = await server.inject({
        method: "POST",
        url: "/api/strategies/ema/pause",
        headers: { cookie: operatorCookie },
        payload: { reason: "denied" }
      });
      expect(denied.statusCode).toBe(403);
      expect((await pool.query("SELECT 1 FROM audit_log")).rows).toHaveLength(0);
      expect((await pool.query("SELECT 1 FROM strategy_control_state")).rows).toHaveLength(0);
    });
    it("rejects unsupported timeframes, extra body fields and unconfirmed resume", async () => {
      expect(
        (
          await server.inject({
            url: "/api/market/candles?interval=4h",
            headers: { cookie: viewerCookie }
          })
        ).statusCode
      ).toBe(400);
      expect((await post("/api/strategies/ema/resume", "resume")).statusCode).toBe(400);
      const invalid = await server.inject({
        method: "POST",
        url: "/api/strategies/ema/pause",
        headers: { cookie: operatorCookie, origin },
        payload: { reason: "pause", unexpected: true }
      });
      expect(invalid.statusCode).toBe(400);
      expect((await pool.query("SELECT 1 FROM audit_log")).rows).toHaveLength(0);
    });
    it("persists pause/resume, actor/reason audit and risk event without clearing global kill", async () => {
      expect((await post("/api/strategies/ema/pause", "inspect")).json().strategy.paused).toBe(
        true
      );
      expect(
        (
          await post("/api/strategies/ema/resume", "reviewed", operatorCookie, "RESUME_STRATEGY")
        ).json().strategy.paused
      ).toBe(false);
      const state = await pool.query(
        "SELECT paused FROM strategy_control_state WHERE strategy_id='ema'"
      );
      expect(state.rows[0].paused).toBe(false);
      const audits = await pool.query("SELECT actor,action,details FROM audit_log ORDER BY id");
      expect(audits.rows).toEqual([
        {
          actor: "operator-token",
          action: "api-strategy-paused",
          details: { strategyId: "ema", reason: "inspect" }
        },
        {
          actor: "operator-token",
          action: "api-strategy-resumed",
          details: { strategyId: "ema", reason: "reviewed" }
        }
      ]);
      expect((await pool.query("SELECT 1 FROM risk_events")).rows).toHaveLength(2);
      expect(
        (await pool.query("SELECT engaged FROM risk_control_state WHERE scope='global'")).rows[0]
          .engaged
      ).toBe(true);
    });
    it("rolls back strategy state when either audit or event persistence fails", async () => {
      for (const reason of ["reject-audit", "reject-event"]) {
        const result = await post("/api/strategies/ema/pause", reason);
        expect(result.statusCode).toBe(503);
        expect(result.body).not.toContain("test audit");
        expect(
          (await pool.query("SELECT paused FROM strategy_control_state WHERE strategy_id='ema'"))
            .rows[0].paused
        ).toBe(false);
        expect(
          (await pool.query("SELECT 1 FROM audit_log WHERE details->>'reason'=$1", [reason])).rows
        ).toHaveLength(0);
      }
    });
    it("rolls back kill state on audit failure and sets the isolated Redis flag only after commit", async () => {
      await pool.query(
        "UPDATE risk_control_state SET engaged=false,reason='test initial state' WHERE scope='global'"
      );
      expect((await post("/api/risk/kill-switch/engage", "reject-audit")).statusCode).toBe(503);
      expect(
        (await pool.query("SELECT engaged FROM risk_control_state WHERE scope='global'")).rows[0]
          .engaged
      ).toBe(false);
      expect(await redis.get(`${namespace}:kill-switch`)).toBeNull();
      const success = await post("/api/risk/kill-switch/engage", "emergency");
      expect(success.statusCode).toBe(200);
      expect(success.json()).toMatchObject({ redisUpdated: true, riskControl: { engaged: true } });
      expect(await redis.get(`${namespace}:kill-switch`)).toBe("1");
      expect(
        (await pool.query("SELECT actor FROM audit_log WHERE action='api-kill-switch-engaged'"))
          .rows
      ).toEqual([{ actor: "operator-token" }]);
    });
    it("reports degraded Redis propagation without losing the durable engaged state", async () => {
      failRedis = true;
      try {
        const result = await post("/api/risk/kill-switch/engage", "Redis outage");
        expect(result.statusCode).toBe(200);
        expect(result.json()).toMatchObject({
          redisUpdated: false,
          riskControl: { engaged: true, reason: "Redis outage" }
        });
        expect(
          (await pool.query("SELECT engaged FROM risk_control_state WHERE scope='global'")).rows[0]
            .engaged
        ).toBe(true);
      } finally {
        failRedis = false;
      }
    });
  }
);
