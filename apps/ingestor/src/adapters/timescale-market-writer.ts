import type { KlineRow, TradeRow } from "../market/market-batch-writer.js";

export interface SqlQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

export interface TimescaleMarketWriterDeps {
  readonly execute: (query: SqlQuery) => Promise<void>;
}

export interface TimescaleMarketWriter {
  readonly upsertTrades: (rows: readonly TradeRow[]) => Promise<void>;
  readonly upsertKlines: (rows: readonly KlineRow[]) => Promise<void>;
}

export function createTimescaleMarketWriter(
  deps: TimescaleMarketWriterDeps
): TimescaleMarketWriter {
  return {
    async upsertTrades(rows) {
      if (rows.length === 0) return;

      const values: unknown[] = [];
      const placeholders = rows.map((row, rowIndex) => {
        const start = rowIndex * 7;

        values.push(
          row.symbol,
          row.eventId,
          row.tradeId,
          new Date(row.eventTimeMs),
          row.price.toString(),
          row.quantity.toString(),
          row.isBuyerMaker
        );

        return `($${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}, $${start + 5}, $${start + 6}, $${start + 7})`;
      });

      await deps.execute({
        text: `
          INSERT INTO trades (
            symbol,
            event_id,
            trade_id,
            event_time,
            price,
            quantity,
            is_buyer_maker
          )
          VALUES ${placeholders.join(", ")}
          ON CONFLICT (symbol, event_id)
          DO UPDATE SET
            trade_id = EXCLUDED.trade_id,
            event_time = EXCLUDED.event_time,
            price = EXCLUDED.price,
            quantity = EXCLUDED.quantity,
            is_buyer_maker = EXCLUDED.is_buyer_maker
        `,
        values
      });
    },

    async upsertKlines(rows) {
      if (rows.length === 0) return;

      const values: unknown[] = [];
      const placeholders = rows.map((row, rowIndex) => {
        const start = rowIndex * 11;

        values.push(
          row.symbol,
          row.eventId,
          row.interval,
          new Date(row.openTimeMs),
          new Date(row.closeTimeMs),
          row.open.toString(),
          row.high.toString(),
          row.low.toString(),
          row.close.toString(),
          row.volume.toString(),
          row.closed
        );

        return `($${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}, $${start + 5}, $${start + 6}, $${start + 7}, $${start + 8}, $${start + 9}, $${start + 10}, $${start + 11})`;
      });

      await deps.execute({
        text: `
          INSERT INTO klines (
            symbol,
            event_id,
            interval,
            open_time,
            close_time,
            open,
            high,
            low,
            close,
            volume,
            closed
          )
          VALUES ${placeholders.join(", ")}
          ON CONFLICT (symbol, interval, open_time)
          DO UPDATE SET
            event_id = EXCLUDED.event_id,
            close_time = EXCLUDED.close_time,
            open = EXCLUDED.open,
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            close = EXCLUDED.close,
            volume = EXCLUDED.volume,
            closed = EXCLUDED.closed
        `,
        values
      });
    }
  };
}
