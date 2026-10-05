export interface SqlQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

export interface BacktestResultReaderDeps {
  readonly query: (query: SqlQuery) => Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

export interface SavedBacktestRunSummary {
  readonly runId: string;
  readonly strategy: string;
  readonly symbol: string;
  readonly interval: string;
  readonly fromMs: number;
  readonly toMs: number;
  readonly createdAt: string;
  readonly metrics: Record<string, unknown>;
}

export interface SavedBacktestFill {
  readonly index: number;
  readonly symbol: string;
  readonly side: string;
  readonly quantity: string;
  readonly price: string;
  readonly fee: string;
  readonly feeAsset: string;
  readonly tsMs: number;
}

export interface SavedBacktestEquityPoint {
  readonly index: number;
  readonly tsMs: number;
  readonly equity: string;
}

export interface SavedBacktestRunReport extends SavedBacktestRunSummary {
  readonly params: Record<string, unknown>;
  readonly fills: readonly SavedBacktestFill[];
  readonly equityCurve: readonly SavedBacktestEquityPoint[];
}

export function createBacktestResultReader(deps: BacktestResultReaderDeps) {
  return {
    async listRecent(limit = 20): Promise<readonly SavedBacktestRunSummary[]> {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new Error("Backtest run list limit must be between 1 and 100");
      }

      const result = await deps.query({
        text: `
          SELECT run_id, strategy, symbol, interval, from_ms, to_ms, metrics, created_at
          FROM backtest_runs
          ORDER BY created_at DESC
          LIMIT $1
        `,
        values: [limit]
      });

      return result.rows.map(mapSummaryRow);
    },

    async getReport(runId: string): Promise<SavedBacktestRunReport> {
      if (runId.trim() === "") {
        throw new Error("Backtest run id is required");
      }

      const run = await deps.query({
        text: `
          SELECT run_id, strategy, symbol, interval, from_ms, to_ms, params, metrics, created_at
          FROM backtest_runs
          WHERE run_id = $1
          LIMIT 1
        `,
        values: [runId]
      });

      const row = run.rows[0];
      if (row === undefined) {
        throw new Error(`Backtest run not found: ${runId}`);
      }

      const [fills, equityCurve] = await Promise.all([
        deps.query({
          text: `
            SELECT fill_index, symbol, side, quantity, price, fee, fee_asset, ts_ms
            FROM backtest_fills
            WHERE run_id = $1
            ORDER BY fill_index ASC
          `,
          values: [runId]
        }),
        deps.query({
          text: `
            SELECT point_index, ts_ms, equity
            FROM backtest_equity_points
            WHERE run_id = $1
            ORDER BY point_index ASC
          `,
          values: [runId]
        })
      ]);

      return {
        ...mapSummaryRow(row),
        params: asObject(row.params, "params"),
        fills: fills.rows.map(mapFillRow),
        equityCurve: equityCurve.rows.map(mapEquityRow)
      };
    }
  };
}

function mapSummaryRow(row: Record<string, unknown>): SavedBacktestRunSummary {
  return {
    runId: asString(row.run_id, "run_id"),
    strategy: asString(row.strategy, "strategy"),
    symbol: asString(row.symbol, "symbol"),
    interval: asString(row.interval, "interval"),
    fromMs: asInteger(row.from_ms, "from_ms"),
    toMs: asInteger(row.to_ms, "to_ms"),
    createdAt: asDateString(row.created_at, "created_at"),
    metrics: asObject(row.metrics, "metrics")
  };
}

function mapFillRow(row: Record<string, unknown>): SavedBacktestFill {
  return {
    index: asInteger(row.fill_index, "fill_index"),
    symbol: asString(row.symbol, "symbol"),
    side: asString(row.side, "side"),
    quantity: asString(row.quantity, "quantity"),
    price: asString(row.price, "price"),
    fee: asString(row.fee, "fee"),
    feeAsset: asString(row.fee_asset, "fee_asset"),
    tsMs: asInteger(row.ts_ms, "ts_ms")
  };
}

function mapEquityRow(row: Record<string, unknown>): SavedBacktestEquityPoint {
  return {
    index: asInteger(row.point_index, "point_index"),
    tsMs: asInteger(row.ts_ms, "ts_ms"),
    equity: asString(row.equity, "equity")
  };
}

function asString(value: unknown, name: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  throw new Error(`Invalid saved backtest ${name}`);
}

function asInteger(value: unknown, name: string): number {
  const numberValue = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(numberValue)) {
    throw new Error(`Invalid saved backtest ${name}`);
  }
  return numberValue;
}

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value === "string") {
    const parsed = JSON.parse(value) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error(`Invalid saved backtest ${name}`);
}

function asDateString(value: unknown, name: string): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  throw new Error(`Invalid saved backtest ${name}`);
}
