import Fastify from "fastify";
import type { Pool } from "pg";
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform
} from "fastify-type-provider-zod";
import swagger from "@fastify/swagger";
import { describe, expect, it, vi } from "vitest";
import { Decimal } from "@meridian/core";
import { registerResponseContracts } from "./response-contracts.js";
import { registerApiRoutes } from "./register-routes.js";
import { createPortfolioReader } from "../features/account/portfolio.js";

async function app() {
  const server = Fastify();
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  await server.register(swagger, {
    openapi: { info: { title: "test", version: "1" } },
    transform: jsonSchemaTransform
  });
  registerResponseContracts(server);
  return server;
}
describe("REST response contracts", () => {
  it("rejects malformed success DTOs with a sanitized 500", async () => {
    const server = await app();
    server.get("/api/orders", async () => ({
      checkedAt: 1,
      orders: [{ secret: "private DB URL", quantity: 123 }]
    }));
    try {
      const response = await server.inject("/api/orders");
      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({ error: "response_contract_violation" });
      expect(response.body).not.toContain("private");
    } finally {
      await server.close();
    }
  });
  it("serializes Decimal-backed market data without converting monetary values to numbers", async () => {
    const server = await app();
    server.get("/api/market/snapshot", async () => ({
      checkedAt: 1,
      symbol: "BTCUSDT",
      interval: "15m",
      cursor: "cursor",
      trades: [],
      candles: [],
      book: {
        symbol: "BTCUSDT",
        eventTimeMs: 1,
        lastUpdateId: 1,
        depthLimit: 100,
        complete: false,
        bids: [{ price: new Decimal("80000.00000001"), quantity: new Decimal("0.0002") }],
        asks: []
      }
    }));
    try {
      const response = await server.inject("/api/market/snapshot");
      expect(response.statusCode).toBe(200);
      expect(response.json().book.bids[0]).toEqual({ price: "80000.00000001", quantity: "0.0002" });
    } finally {
      await server.close();
    }
  });
  it("validates all registered legacy read DTOs and documents their response shapes", async () => {
    const server = await app();
    const pool = { query: vi.fn(async () => ({ rows: [] })) } as unknown as Pool;
    const portfolio = createPortfolioReader(
      pool,
      {
        metadata: async () => [],
        mark: async () => {
          throw new Error("unused");
        }
      },
      "testnet"
    );
    registerApiRoutes(server, {
      pool,
      portfolio,
      auth: {},
      workspace: `${process.cwd()}/logs/test-no-recordings`,
      redis: {
        xRevRange: async () => [],
        xLen: async () => 0,
        info: async () => "used_memory:0",
        sendCommand: async () => "OK"
      }
    });
    try {
      for (const path of [
        "/api/orders",
        "/api/fills",
        "/api/strategies",
        "/api/risk/events",
        "/api/risk/state",
        "/api/trading/state",
        "/api/positions",
        "/api/account/summary",
        "/api/account/portfolio",
        "/api/market/candles",
        "/api/dashboard",
        "/api/backtests"
      ]) {
        const response = await server.inject(path);
        expect(response.statusCode, path).toBe(200);
        const spec = server.swagger() as {
          paths: Record<string, { get: { responses: Record<string, { content: unknown }> } }>;
        };
        expect(spec.paths[path]?.get.responses["200"]?.content, path).toBeDefined();
      }
      expect((await server.inject("/api/backtests/missing")).statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });
  it("checks saved backtest timestamps and decimal history contracts", async () => {
    const server = await app();
    server.get("/api/backtests", async () => ({
      runs: [
        {
          runId: "run",
          strategy: "ema",
          symbol: "BTCUSDT",
          interval: "1m",
          fromMs: "1",
          toMs: "2",
          metrics: { sharpe: 1 },
          createdAt: new Date(0)
        }
      ]
    }));
    try {
      expect((await server.inject("/api/backtests")).json().runs[0].createdAt).toBe(
        "1970-01-01T00:00:00.000Z"
      );
    } finally {
      await server.close();
    }
  });
});
