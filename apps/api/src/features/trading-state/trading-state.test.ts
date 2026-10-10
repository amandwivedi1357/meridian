import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { registerTradingState } from "./trading-state.js";

describe("trading state API", () => {
  function setup(options: { fail?: boolean } = {}) {
    const server = Fastify();
    const query = vi.fn(async (sql: string) => {
      if (options.fail) throw new Error("database unavailable");

      if (sql.includes("FROM orders")) {
        return {
          rows: [
            {
              client_order_id: "mrd_1",
              strategy_id: "ema-live",
              signal_id: "sig_1",
              symbol: "BTCUSDT",
              side: "BUY",
              type: "LIMIT",
              state: "FILLED",
              quantity: "0.0002",
              limit_price: "82835.62",
              executed_quantity: "0.0002",
              cumulative_quote_quantity: "16.56712400",
              exchange_order_id: "1121577",
              created_at_ms: "1791622374000",
              updated_at_ms: "1791622375000"
            }
          ]
        };
      }

      if (sql.includes("FROM order_fills")) {
        return {
          rows: [
            {
              client_order_id: "mrd_1",
              strategy_id: "ema-live",
              execution_id: "rest:211165",
              trade_id: "211165",
              symbol: "BTCUSDT",
              side: "BUY",
              quantity: "0.0002",
              price: "82835.62",
              fee: "0",
              fee_asset: "BTC",
              event_time_ms: "1791622374905"
            }
          ]
        };
      }

      if (sql.includes("FROM risk_events")) {
        return {
          rows: [
            {
              id: "7",
              ts_ms: "1791622376000",
              type: "signal-approved",
              details: { symbol: "BTCUSDT", strategyId: "ema-live" }
            }
          ]
        };
      }

      if (sql.includes("FROM risk_control_state")) {
        return {
          rows: [
            {
              scope: "global",
              engaged: false,
              reason: "operator-reset",
              updated_at_ms: "1791622300000"
            }
          ]
        };
      }

      if (sql.includes("FROM strategy_control_state")) {
        return {
          rows: [
            {
              strategy_id: "ema-live",
              paused: true,
              reason: "pause for inspection",
              updated_at_ms: "1791622376000"
            }
          ]
        };
      }

      throw new Error(`unexpected query: ${sql}`);
    });

    registerTradingState(server, { query } as unknown as Pool);
    return { server, query };
  }

  it("returns recent orders, fills, risk events, and risk control state", async () => {
    const { server } = setup();
    try {
      const response = await server.inject({ method: "GET", url: "/api/trading/state" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      const body = response.json();

      expect(body.orders).toEqual([
        {
          clientOrderId: "mrd_1",
          strategyId: "ema-live",
          signalId: "sig_1",
          symbol: "BTCUSDT",
          side: "BUY",
          type: "LIMIT",
          state: "FILLED",
          quantity: "0.0002",
          limitPrice: "82835.62",
          executedQuantity: "0.0002",
          cumulativeQuoteQuantity: "16.56712400",
          exchangeOrderId: "1121577",
          createdAtMs: 1_791_622_374_000,
          updatedAtMs: 1_791_622_375_000
        }
      ]);
      expect(body.fills[0]).toMatchObject({
        clientOrderId: "mrd_1",
        strategyId: "ema-live",
        executionId: "rest:211165",
        tradeId: "211165",
        price: "82835.62",
        feeAsset: "BTC",
        eventTimeMs: 1_791_622_374_905
      });
      expect(body.riskEvents[0]).toEqual({
        id: "7",
        tsMs: 1_791_622_376_000,
        type: "signal-approved",
        details: { symbol: "BTCUSDT", strategyId: "ema-live" }
      });
      expect(body.riskControl).toEqual({
        scope: "global",
        engaged: false,
        reason: "operator-reset",
        updatedAtMs: 1_791_622_300_000
      });
      expect(body.strategies).toEqual([
        {
          strategyId: "ema-live",
          paused: true,
          reason: "pause for inspection",
          updatedAtMs: 1_791_622_376_000
        }
      ]);
      expect(response.body).not.toMatch(/postgres:\/\/|redis:\/\//);
    } finally {
      await server.close();
    }
  });

  it("caps caller-provided limits to a safe maximum", async () => {
    const { server, query } = setup();
    try {
      const response = await server.inject({
        method: "GET",
        url: "/api/trading/state?limit=5000"
      });
      expect(response.statusCode).toBe(200);
      expect(query).toHaveBeenCalledWith(expect.stringContaining("LIMIT $1"), [100]);
    } finally {
      await server.close();
    }
  });

  it("reports database failures without pretending the system is healthy", async () => {
    const { server } = setup({ fail: true });
    try {
      const response = await server.inject({ method: "GET", url: "/api/trading/state" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        error: "trading_state_unavailable",
        message: "Trading state is unavailable"
      });
      expect(response.body).not.toMatch(/database unavailable|postgres:\/\//);
    } finally {
      await server.close();
    }
  });
});
