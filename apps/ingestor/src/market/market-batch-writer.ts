import type { Decimal } from "@meridian/core";
import type { NormalizedMarketEvent } from "./market-events.js";

export interface TradeRow {
  readonly symbol: string;
  readonly eventId: string;
  readonly tradeId: string;
  readonly eventTimeMs: number;
  readonly price: Decimal;
  readonly quantity: Decimal;
  readonly isBuyerMaker: boolean;
}

export interface KlineRow {
  readonly symbol: string;
  readonly eventId: string;
  readonly interval: string;
  readonly openTimeMs: number;
  readonly closeTimeMs: number;
  readonly open: Decimal;
  readonly high: Decimal;
  readonly low: Decimal;
  readonly close: Decimal;
  readonly volume: Decimal;
  readonly closed: boolean;
}

export interface MarketBatchWriterDeps {
  readonly upsertTrades: (rows: readonly TradeRow[]) => Promise<void>;
  readonly upsertKlines: (rows: readonly KlineRow[]) => Promise<void>;
}

export interface MarketBatchWriteResult {
  readonly tradesWritten: number;
  readonly klinesWritten: number;
  readonly duplicatesSkipped: number;
}

export async function writeMarketEventBatch(
  events: readonly NormalizedMarketEvent[],
  deps: MarketBatchWriterDeps
): Promise<MarketBatchWriteResult> {
  const seen = new Set<string>();
  const tradeRows: TradeRow[] = [];
  const klineRows: KlineRow[] = [];
  let duplicatesSkipped = 0;

  for (const event of events) {
    const dedupKey = `${event.kind}:${event.symbol}:${event.eventId}`;

    if (seen.has(dedupKey)) {
      duplicatesSkipped += 1;
      continue;
    }

    seen.add(dedupKey);

    switch (event.kind) {
      case "trade":
        tradeRows.push({
          symbol: event.symbol,
          eventId: event.eventId,
          tradeId: event.trade.tradeId,
          eventTimeMs: event.trade.eventTimeMs,
          price: event.trade.price,
          quantity: event.trade.quantity,
          isBuyerMaker: event.trade.isBuyerMaker
        });
        break;

      case "kline":
        klineRows.push({
          symbol: event.symbol,
          eventId: event.eventId,
          interval: event.candle.interval,
          openTimeMs: event.candle.openTimeMs,
          closeTimeMs: event.candle.closeTimeMs,
          open: event.candle.open,
          high: event.candle.high,
          low: event.candle.low,
          close: event.candle.close,
          volume: event.candle.volume,
          closed: event.candle.closed
        });
        break;

      case "depth":
        break;
    }
  }

  if (tradeRows.length > 0) {
    await deps.upsertTrades(tradeRows);
  }

  if (klineRows.length > 0) {
    await deps.upsertKlines(klineRows);
  }

  return {
    tradesWritten: tradeRows.length,
    klinesWritten: klineRows.length,
    duplicatesSkipped
  };
}