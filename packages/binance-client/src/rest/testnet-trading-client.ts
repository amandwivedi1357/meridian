import { z } from "zod";
import { createBinanceAccountClient } from "./account-client.js";
import { createBinanceOrderClient, type OrderClientOptions } from "./order-client.js";
import { TokenBucketRateLimiter } from "./rate-limiter.js";
import { createServerTimeClock } from "./server-time-clock.js";
import {
  createTestnetUserDataStream,
  type UserDataStreamOptions
} from "../streams/user-data-stream.js";

export interface TestnetTradingClientOptions extends Omit<OrderClientOptions, "now"> {
  readonly nowMs?: () => number;
  readonly maxClockAgeMs?: number;
  readonly maxRoundTripMs?: number;
  readonly userData?: Pick<
    UserDataStreamOptions,
    | "createWebSocket"
    | "heartbeatIntervalMs"
    | "heartbeatTimeoutMs"
    | "reconnectBaseDelayMs"
    | "reconnectMaxDelayMs"
    | "rotationIntervalMs"
    | "random"
  >;
}

const serverTimeSchema = z.object({ serverTime: z.number().int().safe().nonnegative() });

export function createTestnetTradingClient(options: TestnetTradingClientOptions) {
  const fetchRequest = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const rateLimiter =
    options.rateLimiter ??
    new TokenBucketRateLimiter({
      capacity: 1_200,
      refillIntervalMs: 60_000
    });
  const clock = createServerTimeClock({
    ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
    ...(options.maxClockAgeMs === undefined ? {} : { maxAgeMs: options.maxClockAgeMs }),
    ...(options.maxRoundTripMs === undefined ? {} : { maxRoundTripMs: options.maxRoundTripMs }),
    async getServerTime() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchRequest("https://testnet.binance.vision/api/v3/time", {
          method: "GET",
          redirect: "error",
          signal: controller.signal
        });
        if (!response.ok) throw new Error("Server-time HTTP error");
        const parsed = serverTimeSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("Invalid server-time response");
        return parsed.data;
      } catch {
        throw new Error("Testnet server-time synchronization failed");
      } finally {
        clearTimeout(timeout);
      }
    }
  });
  // Validate the environment and credentials without issuing any network request.
  const orders = createBinanceOrderClient({
    ...options,
    fetch: fetchRequest,
    rateLimiter,
    now: clock.now
  });
  
  const account = createBinanceAccountClient({
  ...options,
  fetch: fetchRequest,
  rateLimiter,
  now: clock.now
});
  let synchronization: Promise<void> | undefined;
  function synchronizeTime(): Promise<void> {
    if (synchronization === undefined) {
      synchronization = (async () => {
        // Throttle before starting the RTT measurement, not inside it.
        await rateLimiter.acquire(1);
        await clock.synchronize();
      })().finally(() => {
        synchronization = undefined;
      });
    }
    return synchronization;
  }
  const userData = createTestnetUserDataStream({
    ...options.userData,
    apiKey: options.apiKey,
    signer: options.signer,
    now: clock.now,
    prepare: synchronizeTime,
    acquire: (weight) => rateLimiter.acquire(weight),
    ...(options.environment === undefined ? {} : { environment: options.environment }),
    ...(options.recvWindowMs === undefined ? {} : { recvWindowMs: options.recvWindowMs }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
  });
  return { ...orders, ...account, synchronizeTime, userData, close: () => userData.close() };
}
