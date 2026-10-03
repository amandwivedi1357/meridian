import {
  parseKlineResponse,
  type BinanceKlinesResponse
} from "@meridian/binance-client";
import type { Candle } from "@meridian/core";
import type { KlineBackfillRequest } from "../backfill/kline-backfill-planner.js";

export interface BinanceKlineClient {
  readonly getKlines: (params: {
    readonly symbol: string;
    readonly interval: "1m" | "5m" | "15m" | "1h";
    readonly startTime?: number;
    readonly endTime?: number;
    readonly limit?: number;
  }) => Promise<BinanceKlinesResponse>;
}

export function createBinanceKlineBackfillFetcher(client: BinanceKlineClient) {
  return async (request: KlineBackfillRequest): Promise<readonly Candle[]> => {
    const response = await client.getKlines({
      symbol: request.symbol,
      interval: request.interval as "1m" | "5m" | "15m" | "1h",
      startTime: request.startTimeMs,
      endTime: request.endTimeMs,
      limit: request.limit
    });

    return response.map((kline) =>
      parseKlineResponse(request.symbol, request.interval, kline)
    );
  };
}
