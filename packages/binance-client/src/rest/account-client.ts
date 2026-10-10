import { Decimal, type BalanceSnapshot } from "@meridian/core";
import { z } from "zod";

import {
  createAuthenticatedHttp,
  type AuthenticatedHttpOptions,
  type AuthenticatedHttpRequest
} from "./authenticated-http.js";
import { TokenBucketRateLimiter } from "./rate-limiter.js";

export interface AccountClientOptions extends AuthenticatedHttpOptions {
  readonly rateLimiter?: Pick<TokenBucketRateLimiter, "acquire">;
}

export interface GetAccountTradesParams {
  readonly symbol: string;
  readonly orderId?: string;
  readonly startTime?: number;
  readonly endTime?: number;
  readonly limit?: number;
}

export interface BinanceAccountTrade {
  readonly symbol: string;
  readonly tradeId: string;
  readonly orderId: string;
  readonly price: Decimal;
  readonly quantity: Decimal;
  readonly quoteQuantity: Decimal;
  readonly commission: Decimal;
  readonly commissionAsset: string;
  readonly eventTimeMs: number;
  readonly side: "BUY" | "SELL";
}

const accountBalanceSchema = z.object({
  asset: z.string().min(1),
  free: z.string().regex(/^\d+(?:\.\d+)?$/),
  locked: z.string().regex(/^\d+(?:\.\d+)?$/)
});

const accountResponseSchema = z.object({
  balances: z.array(accountBalanceSchema)
});

const decimalStringSchema = z.string().regex(/^\d+(?:\.\d+)?$/);

const accountTradeSchema = z.object({
  symbol: z.string().min(1),
  id: z.number().int().safe().nonnegative(),
  orderId: z.number().int().safe().nonnegative(),
  price: decimalStringSchema,
  qty: decimalStringSchema,
  quoteQty: decimalStringSchema,
  commission: decimalStringSchema,
  commissionAsset: z.string().min(1),
  time: z.number().int().safe().nonnegative(),
  isBuyer: z.boolean()
});

const accountTradesResponseSchema = z.array(accountTradeSchema);

export function createBinanceAccountClient(options: AccountClientOptions) {
  const http = createAuthenticatedHttp(options);
  const rateLimiter =
    options.rateLimiter ??
    new TokenBucketRateLimiter({
      capacity: 1_200,
      refillIntervalMs: 60_000
    });

  async function send(request: AuthenticatedHttpRequest, weight: number): Promise<unknown> {
    await rateLimiter.acquire(weight);
    return http.request<unknown>(request);
  }

  return {
    async getBalances(): Promise<readonly BalanceSnapshot[]> {
      const response = await send(
        {
          method: "GET",
          path: "/api/v3/account"
        },
        20
      );

      const parsed = accountResponseSchema.safeParse(response);
      if (!parsed.success) {
        throw new Error("Invalid account response");
      }

      return parsed.data.balances.map((balance) => ({
        asset: balance.asset,
        free: new Decimal(balance.free),
        locked: new Decimal(balance.locked)
      }));
    },

    async getAccountTrades(input: GetAccountTradesParams): Promise<readonly BinanceAccountTrade[]> {
      validateAccountTradeParams(input);
      const parameters: Record<string, string | undefined> = { symbol: input.symbol };
      if (input.orderId !== undefined) parameters.orderId = input.orderId;
      if (input.startTime !== undefined) parameters.startTime = String(input.startTime);
      if (input.endTime !== undefined) parameters.endTime = String(input.endTime);
      if (input.limit !== undefined) parameters.limit = String(input.limit);

      const response = await send(
        {
          method: "GET",
          path: "/api/v3/myTrades",
          parameters
        },
        20
      );
      const parsed = accountTradesResponseSchema.safeParse(response);
      if (!parsed.success) {
        throw new Error("Invalid account trades response");
      }

      return parsed.data.map((trade) => ({
        symbol: trade.symbol,
        tradeId: String(trade.id),
        orderId: String(trade.orderId),
        price: new Decimal(trade.price),
        quantity: new Decimal(trade.qty),
        quoteQuantity: new Decimal(trade.quoteQty),
        commission: new Decimal(trade.commission),
        commissionAsset: trade.commissionAsset,
        eventTimeMs: trade.time,
        side: trade.isBuyer ? "BUY" : "SELL"
      }));
    }
  };
}

function validateAccountTradeParams(input: GetAccountTradesParams): void {
  if (!/^[A-Z0-9]{2,30}$/.test(input.symbol)) {
    throw new Error("symbol must be an uppercase exchange symbol");
  }
  if (input.orderId !== undefined && !/^\d+$/.test(input.orderId)) {
    throw new Error("orderId must be a non-negative integer string");
  }
  if (input.startTime !== undefined && (!Number.isSafeInteger(input.startTime) || input.startTime < 0)) {
    throw new Error("startTime must be a non-negative safe integer");
  }
  if (input.endTime !== undefined && (!Number.isSafeInteger(input.endTime) || input.endTime < 0)) {
    throw new Error("endTime must be a non-negative safe integer");
  }
  if (
    input.limit !== undefined &&
    (!Number.isSafeInteger(input.limit) || input.limit <= 0 || input.limit > 1_000)
  ) {
    throw new Error("limit must be a positive safe integer no greater than 1000");
  }
}
