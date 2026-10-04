import { Decimal, type Candle } from "@meridian/core";
import type { CandleFeed } from "./candle-feed.js";

export interface KlineRow {
  readonly symbol: string;
  readonly interval: string;
  readonly open_time: Date;
  readonly close_time: Date;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string;
  readonly closed: boolean;
}

export function mapKlineRow(row: KlineRow): Candle {
  return {
    symbol: row.symbol,
    interval: row.interval,
    openTimeMs: row.open_time.getTime(),
    closeTimeMs: row.close_time.getTime(),
    open: new Decimal(row.open),
    high: new Decimal(row.high),
    low: new Decimal(row.low),
    close: new Decimal(row.close),
    volume: new Decimal(row.volume),
    closed: row.closed
  };
}

export interface TimescaleCandleFeedDeps {
  readonly query: (
    text: string,
    values: readonly unknown[]
  ) => Promise<{ readonly rows: readonly KlineRow[] }>;
}

export function createTimescaleCandleFeed(deps: TimescaleCandleFeedDeps): CandleFeed {
  return {
    async *read(request) {
      const { symbol, interval, fromMs, toMs } = request;

      if (
        !Number.isSafeInteger(fromMs) ||
        !Number.isSafeInteger(toMs) ||
        fromMs >= toMs ||
        !Number.isFinite(new Date(fromMs).getTime()) ||
        !Number.isFinite(new Date(toMs).getTime())
      ) {
        throw new Error("Invalid candle feed time range");
      }

      let cursorMs = fromMs;

      while (cursorMs < toMs) {
        const result = await deps.query(
          `SELECT symbol, interval, open_time, close_time,
                  open, high, low, close, volume, closed
           FROM klines
           WHERE symbol = $1 AND interval = $2
             AND open_time >= $3 AND open_time < $4
             AND close_time < $4 AND closed = true
           ORDER BY open_time ASC
           LIMIT 1000`,
          [symbol, interval, new Date(cursorMs), new Date(toMs)]
        );

        if (result.rows.length === 0) return;

        for (const row of result.rows) {
          const candle = mapKlineRow(row);
          yield candle;
          cursorMs = candle.openTimeMs + 1;
        }

        if (result.rows.length < 1000) return;
      }
    }
  };
}
