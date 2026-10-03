import type { Candle } from "@meridian/core";
import {
  planKlineBackfillRequests,
  type KlineBackfillPlanInput,
  type KlineBackfillRequest
} from "./kline-backfill-planner.js";
import type { KlineRow } from "../market/market-batch-writer.js";

export interface KlineBackfillRunnerDeps {
  readonly fetchKlines: (
    request: KlineBackfillRequest
  ) => Promise<readonly Candle[]>;
  readonly upsertKlines: (rows: readonly KlineRow[]) => Promise<void>;
}

export interface KlineBackfillResult {
  readonly requestsPlanned: number;
  readonly requestsCompleted: number;
  readonly candlesWritten: number;
}

export async function runKlineBackfill(
  input: KlineBackfillPlanInput,
  deps: KlineBackfillRunnerDeps
): Promise<KlineBackfillResult> {
  const requests = planKlineBackfillRequests(input);
  let requestsCompleted = 0;
  let candlesWritten = 0;

  for (const request of requests) {
    const candles = await deps.fetchKlines(request);
    requestsCompleted += 1;

    const rows = candles.map(candleToKlineRow);

    if (rows.length > 0) {
      await deps.upsertKlines(rows);
      candlesWritten += rows.length;
    }
  }

  return {
    requestsPlanned: requests.length,
    requestsCompleted,
    candlesWritten
  };
}

function candleToKlineRow(candle: Candle): KlineRow {
  return {
    symbol: candle.symbol,
    eventId: `${candle.interval}:${candle.openTimeMs}`,
    interval: candle.interval,
    openTimeMs: candle.openTimeMs,
    closeTimeMs: candle.closeTimeMs,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    closed: candle.closed
  };
}
