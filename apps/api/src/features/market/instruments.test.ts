import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { describe, expect, it, vi } from "vitest";
import type { BinanceSymbolInfo } from "@meridian/binance-client";
import { listSpotInstruments, registerMarketInstrumentsRoutes } from "./instruments.js";

function symbol(
  value: Pick<
    BinanceSymbolInfo,
    "symbol" | "status" | "baseAsset" | "quoteAsset" | "isSpotTradingAllowed"
  >
): BinanceSymbolInfo {
  return {
    ...value,
    baseAssetPrecision: 8,
    quotePrecision: 8,
    quoteAssetPrecision: 8,
    orderTypes: ["LIMIT", "MARKET"],
    icebergAllowed: false,
    ocoAllowed: false,
    quoteOrderQtyMarketAllowed: true,
    allowTrailingStop: false,
    cancelReplaceAllowed: false,
    isMarginTradingAllowed: false,
    filters: [],
    permissions: ["SPOT"]
  };
}

const info = {
  symbols: [
    symbol({
      symbol: "AAVEUSDT",
      status: "TRADING",
      baseAsset: "AAVE",
      quoteAsset: "USDT",
      isSpotTradingAllowed: true
    }),
    symbol({
      symbol: "SOLUSDT",
      status: "TRADING",
      baseAsset: "SOL",
      quoteAsset: "USDT",
      isSpotTradingAllowed: true
    }),
    symbol({
      symbol: "BTCUSDT",
      status: "TRADING",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      isSpotTradingAllowed: true
    }),
    symbol({
      symbol: "ETHUSDT",
      status: "TRADING",
      baseAsset: "ETH",
      quoteAsset: "USDT",
      isSpotTradingAllowed: true
    }),
    symbol({
      symbol: "BNBBTC",
      status: "TRADING",
      baseAsset: "BNB",
      quoteAsset: "BTC",
      isSpotTradingAllowed: true
    }),
    symbol({
      symbol: "DELISTEDUSDT",
      status: "BREAK",
      baseAsset: "DELISTED",
      quoteAsset: "USDT",
      isSpotTradingAllowed: true
    }),
    symbol({
      symbol: "MARGINUSDT",
      status: "TRADING",
      baseAsset: "MARGIN",
      quoteAsset: "USDT",
      isSpotTradingAllowed: false
    })
  ]
};

describe("market instruments API", () => {
  it("lists tradable Binance spot instruments for the requested quote asset", () => {
    expect(listSpotInstruments(info, { quoteAsset: "USDT" })).toEqual([
      { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING" },
      { symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT", status: "TRADING" },
      { symbol: "SOLUSDT", baseAsset: "SOL", quoteAsset: "USDT", status: "TRADING" },
      { symbol: "AAVEUSDT", baseAsset: "AAVE", quoteAsset: "USDT", status: "TRADING" }
    ]);
  });

  it("serves filtered instruments without leaking upstream failures", async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const load = vi.fn(async () => info);
    registerMarketInstrumentsRoutes(app, load);
    try {
      const response = await app.inject("/api/market/instruments?quoteAsset=USDT&limit=1");
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toMatchObject({
        quoteAsset: "USDT",
        instruments: [{ symbol: "BTCUSDT" }]
      });
    } finally {
      await app.close();
    }
  });

  it("returns 503 when Binance metadata is unavailable", async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    registerMarketInstrumentsRoutes(app, async () => {
      throw new Error("exchangeInfo failed");
    });
    try {
      const response = await app.inject("/api/market/instruments");
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        error: "instruments_unavailable",
        message: "Market instruments are unavailable"
      });
    } finally {
      await app.close();
    }
  });
});
