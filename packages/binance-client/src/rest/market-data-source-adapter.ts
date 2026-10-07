import type { CandleRequest, MarketDataSource } from "@meridian/core";

import { parseKlineResponse } from "./parsers.js";
import type { GetKlinesParams } from "./client.js";
import type { BinanceKlinesResponse } from "./types.js";

export interface BinanceMarketDataSourceClient {
  readonly getKlines: (request: GetKlinesParams) => Promise<BinanceKlinesResponse>;
}

export interface BinanceMarketDataSourceOptions {
  readonly client: BinanceMarketDataSourceClient;
  readonly pageLimit?: number;
}

export function createBinanceMarketDataSource(
  options: BinanceMarketDataSourceOptions
): MarketDataSource {
  const pageLimit = options.pageLimit ?? 500;

  return {
    async *getCandles(request) {
      const requestedLimit = request.limit;
      let emitted = 0;
      let startTime = request.fromMs;

      while (requestedLimit === undefined || emitted < requestedLimit) {
        const remaining =
          requestedLimit === undefined ? pageLimit : Math.min(pageLimit, requestedLimit - emitted);

        const page = await options.client.getKlines({
  symbol: request.symbol,
  interval: request.interval,
  ...(startTime === undefined ? {} : { startTime }),
  ...(request.toMs === undefined ? {} : { endTime: request.toMs }),
  limit: remaining,
});

        if (page.length === 0) return;

        for (const raw of page) {
          yield parseKlineResponse(request.symbol, request.interval, raw);
          emitted += 1;

          if (requestedLimit !== undefined && emitted >= requestedLimit) {
            return;
          }
        }

        startTime = nextStartTime(page);
      }
    },
  };
}

function nextStartTime(page: BinanceKlinesResponse): CandleRequest["fromMs"] {
  const last = page.at(-1);
  if (last === undefined) return undefined;
  return last[6] + 1;
}