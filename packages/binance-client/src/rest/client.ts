import { BINANCE_REST_BASE_URLS, type BinanceEnvironment } from "../constants.js";
import { httpGetJson } from "./http.js";
import { TokenBucketRateLimiter } from "./rate-limiter.js";
import type {
  BinanceDepthResponse,
  BinanceExchangeInfoResponse,
  BinanceKlinesResponse,
  BinanceServerTimeResponse
} from "./types.js";

export interface BinanceRestClientOptions {
  readonly environment?: BinanceEnvironment;
  readonly baseUrl?: string;
  readonly rateLimiter?: TokenBucketRateLimiter;
}

export interface GetDepthParams {
  readonly symbol: string;
  readonly limit?: number;
}

export interface GetKlinesParams {
  readonly symbol: string;
  readonly interval: "1m" | "5m" | "15m" | "1h";
  readonly startTime?: number;
  readonly endTime?: number;
  readonly limit?: number;
}

export class BinanceRestClient {
  private readonly baseUrl: string;
  private readonly rateLimiter: TokenBucketRateLimiter;
  constructor(options: BinanceRestClientOptions = {}) {
    this.rateLimiter =
      options.rateLimiter ??
      new TokenBucketRateLimiter({
        capacity: 1200,
        refillIntervalMs: 60_000
      });
    this.baseUrl = options.baseUrl ?? BINANCE_REST_BASE_URLS[options.environment ?? "production"];
  }

  async getServerTime(): Promise<BinanceServerTimeResponse> {
    await this.rateLimiter.acquire(1);
    return httpGetJson({
      baseUrl: this.baseUrl,
      path: "/api/v3/time"
    });
  }
  async getExchangeInfo(): Promise<BinanceExchangeInfoResponse> {
    await this.rateLimiter.acquire(10);
    return httpGetJson({
      baseUrl: this.baseUrl,
      path: "/api/v3/exchangeInfo"
    });
  }

  async getDepth({ symbol, limit = 100 }: GetDepthParams): Promise<BinanceDepthResponse> {
    await this.rateLimiter.acquire(5);
    return httpGetJson({
      baseUrl: this.baseUrl,
      path: "/api/v3/depth",
      query: { symbol, limit }
    });
  }

  async getKlines({
    symbol,
    interval,
    startTime,
    endTime,
    limit = 500
  }: GetKlinesParams): Promise<BinanceKlinesResponse> {
    await this.rateLimiter.acquire(2);
    return httpGetJson({
      baseUrl: this.baseUrl,
      path: "/api/v3/klines",
      query: {
        symbol,
        interval,
        startTime,
        endTime,
        limit
      }
    });
  }
}
