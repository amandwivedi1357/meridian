const intervalMsByCode = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "8h": 28_800_000,
  "12h": 43_200_000,
  "1d": 86_400_000
} as const;

export interface KlineBackfillPlanInput {
  readonly symbol: string;
  readonly interval: string;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly limit: number;
}

export interface KlineBackfillRequest {
  readonly symbol: string;
  readonly interval: string;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly limit: number;
}

export function planKlineBackfillRequests(
  input: KlineBackfillPlanInput
): readonly KlineBackfillRequest[] {
  const intervalMs = intervalMsByCode[input.interval as keyof typeof intervalMsByCode];

  if (!intervalMs) {
    throw new Error(`Unsupported kline interval: ${input.interval}`);
  }

  if (input.startTimeMs > input.endTimeMs) {
    throw new Error("Backfill start time must be before end time");
  }

  if (!Number.isInteger(input.limit) || input.limit <= 0) {
    throw new Error("Backfill limit must be a positive integer");
  }

  const windowMs = intervalMs * input.limit;
  const requests: KlineBackfillRequest[] = [];

  for (
    let startTimeMs = input.startTimeMs;
    startTimeMs <= input.endTimeMs;
    startTimeMs += windowMs
  ) {
    requests.push({
      symbol: input.symbol,
      interval: input.interval,
      startTimeMs,
      endTimeMs: Math.min(startTimeMs + windowMs - 1, input.endTimeMs),
      limit: input.limit
    });
  }

  return requests;
}