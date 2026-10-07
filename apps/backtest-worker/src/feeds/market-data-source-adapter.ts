import type { CandleRequest, MarketDataSource } from "@meridian/core";

import type { CandleFeed, CandleFeedRequest } from "./candle-feed.js";

export function createCandleFeedMarketDataSource(feed: CandleFeed): MarketDataSource {
  return {
    async *getCandles(request) {
      const feedRequest = toCandleFeedRequest(request);

      for await (const candle of feed.read(feedRequest)) {
        yield candle;
      }
    },
  };
}

function toCandleFeedRequest(request: CandleRequest): CandleFeedRequest {
  if (request.fromMs === undefined || request.toMs === undefined) {
    throw new Error("Candle feed market data requests require fromMs and toMs");
  }

  if (request.interval !== "15m" && request.interval !== "1h") {
    throw new Error("Unsupported candle feed interval");
  }

  return {
    symbol: request.symbol,
    interval: request.interval,
    fromMs: request.fromMs,
    toMs: request.toMs,
  };
}