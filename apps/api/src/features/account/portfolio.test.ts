import type { Pool } from "pg";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  createPortfolioReader,
  registerPortfolioRoute,
  type PortfolioMarket
} from "./portfolio.js";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { registerApiAuth } from "../../app/auth.js";
import { registerPositionsRoutes } from "../positions/positions.js";

const now = 10000;
const fill = (
  side = "BUY",
  quantity = "2",
  price = "100",
  fee = "2",
  fee_asset = "USDT",
  time = "1",
  symbol = "BTCUSDT"
) => ({
  side,
  quantity,
  price,
  fee,
  fee_asset,
  event_time_ms: time,
  symbol
});
function fixture(rows = [fill()], options: { markFail?: boolean; markTime?: number } = {}) {
  const query = vi.fn(async () => ({ rows }));
  const market: PortfolioMarket = {
    metadata: vi.fn(async () => [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" }]),
    mark: vi.fn(async () => {
      if (options.markFail) throw new Error("secret URL");
      return { price: "130", observedAtMs: options.markTime ?? now };
    })
  };
  const pool = { query } as unknown as Pool;
  return { query, market, pool, reader: createPortfolioReader(pool, market, "testnet", () => now) };
}
describe("fee-aware persisted-fill portfolio", () => {
  it("protects the typed portfolio route and preserves nullable unavailable equity", async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    registerApiAuth(app, { viewerToken: "v".repeat(40) });
    registerPortfolioRoute(app, fixture().reader);
    try {
      expect((await app.inject("/api/account/portfolio")).statusCode).toBe(401);
      const result = await app.inject({
        url: "/api/account/portfolio",
        headers: { authorization: `Bearer ${"v".repeat(40)}` }
      });
      expect(result.statusCode).toBe(200);
      expect(result.json().equity).toBeNull();
      expect(result.headers["cache-control"]).toBe("no-store");
    } finally {
      await app.close();
    }
  });
  it("sanitizes database failures on the portfolio route", async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    registerPortfolioRoute(app, async () => {
      throw new Error("private database URL");
    });
    try {
      const result = await app.inject("/api/account/portfolio");
      expect(result.statusCode).toBe(503);
      expect(result.json()).toEqual({ error: "portfolio_unavailable" });
    } finally {
      await app.close();
    }
  });
  it("reports weighted-average realized/unrealized PnL without inventing wallet equity", async () => {
    const { reader } = fixture([fill(), fill("SELL", "1", "120", "1", "USDT", "2")]);
    const result = await reader();
    expect(result).toMatchObject({
      scope: "persisted-fills",
      environment: "testnet",
      equity: null,
      positions: [
        {
          quantity: "1",
          costBasis: "101",
          avgEntry: "101",
          realizedPnl: "18",
          unrealizedPnl: "29",
          marketValue: "130",
          status: "available"
        }
      ],
      totals: [{ quoteAsset: "USDT", realizedPnl: "18", unrealizedPnl: "29", marketValue: "130" }]
    });
  });
  it("uses base fees rather than gross fill sums and does not require a mark for flat inventory", async () => {
    const { reader, market } = fixture([
      fill("BUY", "1", "99", "0.01", "BTC"),
      fill("SELL", "0.98", "110", "0.01", "BTC", "2")
    ]);
    expect((await reader()).positions[0]).toMatchObject({
      quantity: "0",
      realizedPnl: "8.8",
      unrealizedPnl: "0",
      marketValue: "0",
      markPrice: null
    });
    expect(market.mark).not.toHaveBeenCalled();
  });
  it("keeps ledger cost/PnL when a mark is missing, but withholds unrealized totals", async () => {
    const { reader } = fixture([fill()], { markFail: true });
    const result = await reader();
    expect(result.status).toBe("unavailable");
    expect(result.positions[0]).toMatchObject({
      quantity: "2",
      costBasis: "202",
      realizedPnl: "0",
      unrealizedPnl: null,
      reason: "mark_unavailable"
    });
    expect(result.totals[0]?.unrealizedPnl).toBeNull();
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("rejects stale and future marks", async () => {
    for (const markTime of [-6000, 20000]) {
      expect((await fixture([fill()], { markTime }).reader()).positions[0]?.reason).toBe(
        "mark_unavailable"
      );
    }
  });
  it("does not infer cost basis for opening sells or convert third-asset fees at today's price", async () => {
    for (const [row, reason] of [
      [fill("SELL"), "opening_cost_basis_required"],
      [fill("BUY", "1", "100", "1", "BNB"), "historical_fee_conversion_required"]
    ] as const) {
      const { reader, market } = fixture([row]);
      expect((await reader()).positions[0]).toMatchObject({
        quantity: null,
        realizedPnl: null,
        reason
      });
      expect(market.mark).not.toHaveBeenCalled();
    }
  });
  it("does not publish partial totals when symbol metadata is missing", async () => {
    const { reader } = fixture([fill(), fill("BUY", "1", "1", "0", "USDT", "2", "UNKNOWN")]);
    const result = await reader();
    expect(result.status).toBe("unavailable");
    expect(result.totals[0]?.realizedPnl).toBeNull();
  });
  it("shares concurrent reads and caches briefly without truncating replay history", async () => {
    const { reader, query } = fixture();
    const [a, b] = await Promise.all([reader(), reader()]);
    expect(a).toBe(b);
    await reader();
    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("LIMIT 10001"));
    await expect(fixture(Array(10001).fill(fill())).reader()).rejects.toThrow("history_capacity");
  });
  it("returns real marked DTOs through positions rather than legacy gross quantities", async () => {
    const { reader } = fixture();
    const app = Fastify();
    registerPositionsRoutes(app, reader);
    try {
      const result = await app.inject("/api/positions");
      expect(result.statusCode).toBe(200);
      expect(result.json().positions[0]).toMatchObject({
        quantity: "2",
        costBasis: "202",
        unrealizedPnl: "58"
      });
    } finally {
      await app.close();
    }
  });
  it("does not fetch exchange data for an empty ledger", async () => {
    const { reader, market } = fixture([]);
    expect(await reader()).toMatchObject({ positions: [], totals: [], equity: null });
    expect(market.metadata).not.toHaveBeenCalled();
  });
});
