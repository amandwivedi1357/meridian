import { BINANCE_REST_BASE_URLS, type BinanceEnvironment } from "../constants.js";
import { httpGetJson } from "./http.js";
import { TokenBucketRateLimiter } from "./rate-limiter.js";
import { z } from "zod";
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
  readonly fetch?: typeof globalThis.fetch;
}

export interface GetDepthParams {
  readonly symbol: string;
  readonly limit?: number;
  readonly timeoutMs?: number;
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
  private readonly requestFetch: typeof globalThis.fetch | undefined;
  constructor(options: BinanceRestClientOptions = {}) {
    this.requestFetch = options.fetch;
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
      path: "/api/v3/time",
      fetch: this.requestFetch
    });
  }
  async getExchangeInfo(timeoutMs?: number): Promise<BinanceExchangeInfoResponse> {
    await this.rateLimiter.acquire(10);
    return httpGetJson({
      baseUrl: this.baseUrl,
      path: "/api/v3/exchangeInfo",
      fetch: this.requestFetch,
      ...(timeoutMs === undefined ? {} : { timeoutMs })
    });
  }

  async getBookTickers(timeoutMs = 3000) {
    await this.rateLimiter.acquire(4);
    const response = await httpGetJson<unknown>({
      baseUrl: this.baseUrl,
      path: "/api/v3/ticker/bookTicker",
      fetch: this.requestFetch,
      timeoutMs
    });
    const decimal = z
      .string()
      .max(128)
      .regex(/^\d+(?:\.\d+)?$/);
    return z
      .array(z.object({ symbol: z.string().min(1).max(30), bidPrice: decimal, askPrice: decimal }))
      .max(10000)
      .parse(response);
  }

  async getDepth({
    symbol,
    limit = 100,
    timeoutMs
  }: GetDepthParams): Promise<BinanceDepthResponse> {
    await this.rateLimiter.acquire(5);
    return httpGetJson({
      baseUrl: this.baseUrl,
      path: "/api/v3/depth",
      fetch: this.requestFetch,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
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
      fetch: this.requestFetch,
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
