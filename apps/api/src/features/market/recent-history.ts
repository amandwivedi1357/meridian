import { Decimal } from "@meridian/core";
import { z } from "zod";

export type ChartInterval = "1m" | "5m" | "15m" | "1h";
const steps: Record<ChartInterval, number> = {
  "1m": 60000,
  "5m": 300000,
  "15m": 900000,
  "1h": 3600000
};
const amount = z
  .string()
  .max(64)
  .regex(/^\d+(?:\.\d+)?$/);
const timestamp = z.number().int().nonnegative().safe();
const rowsSchema = z
  .array(
    z.tuple([
      timestamp,
      amount,
      amount,
      amount,
      amount,
      amount,
      timestamp,
      amount,
      z.number().int().nonnegative(),
      amount,
      amount,
      z.string().max(64)
    ])
  )
  .min(1)
  .max(200);

export function parseRecentHistory(
  raw: unknown,
  symbol: string,
  interval: ChartInterval,
  endTime: number
) {
  const step = steps[interval];
  const rows = rowsSchema.parse(raw);
  return rows.map((r, index) => {
    if (
      r[0] % step !== 0 ||
      r[6] !== r[0] + step - 1 ||
      r[6] > endTime ||
      (index > 0 && r[0] !== rows[index - 1]![0] + step)
    )
      throw new Error("invalid_chart_history_time");
    const [open, high, low, close] = r.slice(1, 5).map((v) => new Decimal(v));
    if (
      !open!.gt(0) ||
      !low!.gt(0) ||
      low!.gt(high!) ||
      open!.lt(low!) ||
      open!.gt(high!) ||
      close!.lt(low!) ||
      close!.gt(high!)
    )
      throw new Error("invalid_chart_history_ohlc");
    if (index === rows.length - 1 && r[6] !== endTime) throw new Error("stale_chart_history");
    return {
      symbol,
      interval,
      openTimeMs: r[0],
      closeTimeMs: r[6],
      open: r[1],
      high: r[2],
      low: r[3],
      close: r[4],
      volume: r[5],
      closed: true
    };
  });
}

export function createRecentHistoryLoader(
  fetchRows: (symbol: string, interval: ChartInterval, endTime: number) => Promise<unknown>,
  now = Date.now
) {
  const cache = new Map<
    string,
    { expires: number; end: number; work: Promise<ReturnType<typeof parseRecentHistory>> }
  >();
  return (symbol: string, interval: ChartInterval) => {
    const end = Math.floor(now() / steps[interval]) * steps[interval] - 1,
      key = `${symbol}:${interval}`;
    const cached = cache.get(key);
    if (cached && cached.expires > now() && cached.end === end) return cached.work;
    if (cache.size >= 4 && !cache.has(key)) cache.delete(cache.keys().next().value!);
    const entry = {
      expires: now() + 30000,
      end,
      work: Promise.resolve()
        .then(() => fetchRows(symbol, interval, end))
        .then((raw) => parseRecentHistory(raw, symbol, interval, end))
    };
    cache.set(key, entry);
    void entry.work.catch(() => {
      if (cache.get(key) === entry) cache.delete(key);
    });
    return entry.work;
  };
}
