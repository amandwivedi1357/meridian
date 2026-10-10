import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

interface CandleRow {
  readonly symbol: string;
  readonly interval: string;
  readonly open_time_ms: string;
  readonly close_time_ms: string;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string;
  readonly closed: boolean;
}

const allowedIntervals = new Set(["1m", "5m", "15m", "1h"]);

export function registerMarketCandlesRoutes(server: FastifyInstance, pool: Pool): void {
  server.get("/api/market/candles", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const params = readParams(request.query);
    if (params === null) {
      return reply.code(400).send({
        error: "invalid_candle_query",
        message: "A valid symbol, interval, and limit are required"
      });
    }

    try {
      const result = await pool.query<CandleRow>(
        `
          SELECT *
          FROM (
            SELECT
              symbol,
              interval,
              (EXTRACT(EPOCH FROM open_time) * 1000)::bigint::text AS open_time_ms,
              (EXTRACT(EPOCH FROM close_time) * 1000)::bigint::text AS close_time_ms,
              open::text,
              high::text,
              low::text,
              close::text,
              volume::text,
              closed
            FROM klines
            WHERE symbol = $1
              AND interval = $2
            ORDER BY open_time DESC
            LIMIT $3
          ) recent
          ORDER BY open_time_ms ASC
        `,
        [params.symbol, params.interval, params.limit]
      );

      return {
        checkedAt: Date.now(),
        symbol: params.symbol,
        interval: params.interval,
        candles: result.rows.map(toCandle)
      };
    } catch {
      return reply.code(503).send({
        error: "candles_unavailable",
        message: "Market candles are unavailable"
      });
    }
  });
}

function readParams(query: unknown): { symbol: string; interval: string; limit: number } | null {
  if (query === null || typeof query !== "object") return null;
  const record = query as Record<string, unknown>;
  const symbol = typeof record.symbol === "string" ? record.symbol.toUpperCase() : "BTCUSDT";
  const interval = typeof record.interval === "string" ? record.interval : "15m";
  const rawLimit = typeof record.limit === "string" ? Number(record.limit) : 200;

  if (!/^[A-Z0-9]{3,20}$/.test(symbol)) return null;
  if (!allowedIntervals.has(interval)) return null;
  if (!Number.isSafeInteger(rawLimit) || rawLimit <= 0) return null;

  return {
    symbol,
    interval,
    limit: Math.min(rawLimit, 500)
  };
}

function toCandle(row: CandleRow) {
  return {
    symbol: row.symbol,
    interval: row.interval,
    openTimeMs: Number(row.open_time_ms),
    closeTimeMs: Number(row.close_time_ms),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    closed: row.closed
  };
}
