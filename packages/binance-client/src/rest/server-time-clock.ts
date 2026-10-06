import type { BinanceServerTimeResponse } from "./types.js";

export interface ServerTimeClock {
  readonly synchronize: () => Promise<void>;
  readonly now: () => number;
}

export interface ServerTimeClockOptions {
  readonly getServerTime: () => Promise<BinanceServerTimeResponse>;
  readonly nowMs?: () => number;
  readonly maxAgeMs?: number;
  readonly maxRoundTripMs?: number;
}

export function createServerTimeClock(options: ServerTimeClockOptions): ServerTimeClock {
  const nowMs = options.nowMs ?? Date.now;
  const maxAgeMs = options.maxAgeMs ?? 60_000;
  const maxRoundTripMs = options.maxRoundTripMs ?? 1_000;
  for (const value of [maxAgeMs, maxRoundTripMs]) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error("Clock limits must be positive safe integers");
    }
  }

  let sample: { offsetMs: number; receivedAtMs: number; lastNowMs: number } | undefined;
  let inFlight: Promise<void> | undefined;

  async function synchronize(): Promise<void> {
    sample = undefined;
    const sentAtMs = readLocalTime();
    const { serverTime } = await options.getServerTime();
    const receivedAtMs = readLocalTime();
    const roundTripMs = receivedAtMs - sentAtMs;
    if (roundTripMs < 0 || roundTripMs > maxRoundTripMs) {
      throw new Error("Server-time sample has invalid round-trip duration");
    }
    validateTimestamp(serverTime);
    // Estimate the local instant corresponding to serverTime at the RTT midpoint.
    const offsetMs = serverTime - (sentAtMs + roundTripMs / 2);
    validateTimestamp(Math.floor(receivedAtMs + offsetMs));
    sample = { offsetMs, receivedAtMs, lastNowMs: receivedAtMs };
  }

  function readLocalTime(): number {
    const value = nowMs();
    validateTimestamp(value);
    return value;
  }

  return {
    synchronize() {
      if (inFlight === undefined) {
        inFlight = synchronize().finally(() => {
          inFlight = undefined;
        });
      }
      return inFlight;
    },
    now() {
      if (sample === undefined) {
        throw new Error("Server-time clock is not synchronized");
      }
      const localNowMs = readLocalTime();
      if (localNowMs < sample.lastNowMs || localNowMs - sample.receivedAtMs >= maxAgeMs) {
        sample = undefined;
        throw new Error("Server-time clock requires resynchronization");
      }
      sample.lastNowMs = localNowMs;
      const timestamp = Math.floor(localNowMs + sample.offsetMs);
      validateTimestamp(timestamp);
      return timestamp;
    }
  };
}

function validateTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Timestamp must be a nonnegative safe integer");
  }
}
