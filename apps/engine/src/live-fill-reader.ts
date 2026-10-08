import type { LiveFillRow } from "./live-account-state.js";

export interface LiveFillReaderDeps {
  readonly query: (query: {
    readonly text: string;
    readonly values: readonly unknown[];
  }) => Promise<{
    readonly rows: readonly unknown[];
  }>;
}

export interface LiveFillReader {
  readonly listFills: () => Promise<readonly LiveFillRow[]>;
}

export function createLiveFillReader(deps: LiveFillReaderDeps): LiveFillReader {
  return {
    async listFills() {
      const result = await deps.query({
        text: `
          SELECT
            symbol,
            side,
            quantity::text AS quantity,
            price::text AS price,
            fee::text AS fee,
            fee_asset,
            event_time_ms::text AS event_time_ms
          FROM order_fills
          ORDER BY event_time_ms ASC
        `,
        values: []
      });

      return result.rows.map(readLiveFillRow);
    }
  };
}

function readLiveFillRow(value: unknown): LiveFillRow {
  if (value === null || typeof value !== "object") {
    throw new Error("Invalid live fill row");
  }

  const row = value as Record<string, unknown>;

  if (
    typeof row.symbol !== "string" ||
    !/^[A-Z0-9]{2,30}$/.test(row.symbol) ||
    (row.side !== "BUY" && row.side !== "SELL") ||
    typeof row.quantity !== "string" ||
    !isPositiveDecimal(row.quantity) ||
    typeof row.price !== "string" ||
    !isPositiveDecimal(row.price) ||
    typeof row.fee !== "string" ||
    !isNonNegativeDecimal(row.fee) ||
    typeof row.fee_asset !== "string" ||
    row.fee_asset.trim() === "" ||
    typeof row.event_time_ms !== "string" ||
    !/^\d+$/.test(row.event_time_ms)
  ) {
    throw new Error("Invalid live fill row");
  }

  const eventTimeMs = Number(row.event_time_ms);
  if (!Number.isSafeInteger(eventTimeMs)) {
    throw new Error("Invalid live fill row");
  }

  return {
    symbol: row.symbol,
    side: row.side,
    quantity: row.quantity,
    price: row.price,
    fee: row.fee,
    feeAsset: row.fee_asset,
    eventTimeMs
  };
}

function isNonNegativeDecimal(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value);
}

function isPositiveDecimal(value: string): boolean {
  return isNonNegativeDecimal(value) && /[1-9]/.test(value);
}