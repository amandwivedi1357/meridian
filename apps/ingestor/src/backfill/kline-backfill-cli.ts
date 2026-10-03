import type { KlineBackfillPlanInput } from "./kline-backfill-planner.js";

export function parseKlineBackfillArgs(
  args: readonly string[]
): KlineBackfillPlanInput {
  const flags = parseFlags(args);

  const symbol = required(flags, "symbol");
  const interval = required(flags, "interval");
  const startTimeMs = parseDateMs(required(flags, "start"), "start");
  const endTimeMs = parseDateMs(required(flags, "end"), "end");
  const limit = flags.limit === undefined ? 1000 : parseLimit(flags.limit);

  return {
    symbol,
    interval,
    startTimeMs,
    endTimeMs,
    limit
  };
}

function parseFlags(args: readonly string[]): Record<string, string> {
  const flags: Record<string, string> = {};

  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];

    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Invalid CLI argument near: ${key ?? "<end>"}`);
    }

    flags[key.slice(2)] = value;
  }

  return flags;
}

function required(flags: Record<string, string>, name: string): string {
  const value = flags[name];

  if (!value) {
    throw new Error(`Missing required flag: --${name}`);
  }

  return value;
}

function parseDateMs(value: string, name: string): number {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid --${name} date: ${value}`);
  }

  return timestamp;
}

function parseLimit(value: string): number {
  const limit = Number(value);

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`Invalid --limit: ${value}`);
  }

  return limit;
}