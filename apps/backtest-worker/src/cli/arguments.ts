import type { CandleFeedRequest } from "../feeds/candle-feed.js";

export interface BacktestCliArgs {
  readonly strategy: "ema";
  readonly request: CandleFeedRequest;
  readonly saveRun: boolean;
  readonly runId?: string;
}

export function parseBacktestArgs(args: readonly string[]): BacktestCliArgs {
  const valueFlags = new Set(["--strategy", "--symbol", "--interval", "--from", "--to", "--run-id"]);
  const booleanFlags = new Set(["--save-run"]);
  const flags = new Map<string, string>();
  const switches = new Set<string>();

  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!flag || (!valueFlags.has(flag) && !booleanFlags.has(flag))) {
      throw new Error("Unknown, duplicate, or incomplete CLI flag");
    }

    if (booleanFlags.has(flag)) {
      if (switches.has(flag)) {
        throw new Error("Unknown, duplicate, or incomplete CLI flag");
      }
      switches.add(flag);
      continue;
    }

    const value = args[index + 1];
    if (flags.has(flag) || !value || value.startsWith("--")) {
      throw new Error("Unknown, duplicate, or incomplete CLI flag");
    }

    flags.set(flag, value);
    index++;
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

  const runId = flags.get("--run-id");
  const saveRun = switches.has("--save-run");
  if (runId !== undefined && !saveRun) {
    throw new Error("--run-id requires --save-run");
  }
  if (runId !== undefined && !/^[A-Za-z0-9._:-]+$/.test(runId)) {
    throw new Error("Run id may only contain letters, numbers, dots, underscores, colons, and dashes");
  }

  return {
    strategy: "ema",
    request: { symbol, interval, fromMs, toMs },
    saveRun,
    ...(runId === undefined ? {} : { runId })
  };
}
