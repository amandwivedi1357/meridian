import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BinanceExchangeInfoResponse, BinanceSymbolInfo } from "@meridian/binance-client";

export interface MarketInstrument {
  readonly symbol: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly status: string;
}

const preferredSymbols = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "LINKUSDT",
  "AVAXUSDT",
  "LTCUSDT"
];
const preferredRank = new Map(preferredSymbols.map((symbol, index) => [symbol, index]));

export function listSpotInstruments(
  exchangeInfo: Pick<BinanceExchangeInfoResponse, "symbols">,
  options: { quoteAsset?: string; limit?: number } = {}
): MarketInstrument[] {
  const quoteAsset = options.quoteAsset?.toUpperCase() ?? "USDT";
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
  return exchangeInfo.symbols
    .filter((symbol): symbol is BinanceSymbolInfo => {
      return (
        symbol.status === "TRADING" &&
        symbol.isSpotTradingAllowed &&
        symbol.quoteAsset === quoteAsset &&
        /^[A-Z0-9]{3,30}$/.test(symbol.symbol)
      );
    })
    .map((symbol) => ({
      symbol: symbol.symbol,
      baseAsset: symbol.baseAsset,
      quoteAsset: symbol.quoteAsset,
      status: symbol.status
    }))
    .sort((a, b) => {
      const left = preferredRank.get(a.symbol);
      const right = preferredRank.get(b.symbol);
      if (left !== undefined || right !== undefined)
        return (left ?? Number.MAX_SAFE_INTEGER) - (right ?? Number.MAX_SAFE_INTEGER);
      return a.symbol.localeCompare(b.symbol);
    })
    .slice(0, limit);
}

export function registerMarketInstrumentsRoutes(
  server: FastifyInstance,
  loadExchangeInfo: () => Promise<Pick<BinanceExchangeInfoResponse, "symbols">>
): void {
  server.get(
    "/api/market/instruments",
    {
      schema: {
        querystring: z
          .object({
            quoteAsset: z
              .string()
              .regex(/^[A-Z0-9]{2,12}$/)
              .optional(),
            limit: z
              .string()
              .regex(/^\d{1,3}$/)
              .optional()
          })
          .strict()
      }
    },
    async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const query = request.query as Record<string, unknown>;
    const quoteAsset =
      typeof query.quoteAsset === "string" && /^[A-Z0-9]{2,12}$/.test(query.quoteAsset)
        ? query.quoteAsset
        : "USDT";
    const limit =
      typeof query.limit === "string" && Number.isSafeInteger(Number(query.limit))
        ? Number(query.limit)
        : 200;
    try {
      return {
        checkedAt: Date.now(),
        quoteAsset: quoteAsset.toUpperCase(),
        instruments: listSpotInstruments(await loadExchangeInfo(), { quoteAsset, limit })
      };
    } catch {
      return reply.code(503).send({
        error: "instruments_unavailable",
        message: "Market instruments are unavailable"
      });
    }
  });
}
