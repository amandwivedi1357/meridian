import type { CandleFeedRequest } from "../feeds/candle-feed.js";

export interface BacktestCliArgs {
  readonly strategy: "ema";
  readonly request: CandleFeedRequest;
}

export function parseBacktestArgs(args: readonly string[]): BacktestCliArgs {
  const allowed = new Set(["--strategy", "--symbol", "--interval", "--from", "--to"]);
  const flags = new Map<string, string>();

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag || !allowed.has(flag) || flags.has(flag) || !value || value.startsWith("--")) {
      throw new Error("Unknown, duplicate, or incomplete CLI flag");
    }
    flags.set(flag, value);
  }

  const strategy = flags.get("--strategy") ?? "ema";
  const symbol = flags.get("--symbol") ?? "BTCUSDT";
  const interval = flags.get("--interval") ?? "15m";

  if (strategy !== "ema" || symbol !== "BTCUSDT") {
    throw new Error("This slice supports EMA on BTCUSDT only");
  }
  if (interval !== "15m" && interval !== "1h") {
    throw new Error("Interval must be 15m or 1h");
  }

  function utcDate(value: string | undefined): number {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error("Dates must use YYYY-MM-DD in UTC");
    }
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
      throw new Error("Invalid calendar date");
    }
    return timestamp;
  }

  const fromMs = utcDate(flags.get("--from"));
  const toMs = utcDate(flags.get("--to"));
  if (fromMs >= toMs) throw new Error("From must precede to");

  return {
    strategy: "ema",
    request: { symbol, interval, fromMs, toMs }
  };
}
