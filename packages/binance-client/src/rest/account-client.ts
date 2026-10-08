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

const accountBalanceSchema = z.object({
  asset: z.string().min(1),
  free: z.string().regex(/^\d+(?:\.\d+)?$/),
  locked: z.string().regex(/^\d+(?:\.\d+)?$/)
});

const accountResponseSchema = z.object({
  balances: z.array(accountBalanceSchema)
});

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
    }
  };
}