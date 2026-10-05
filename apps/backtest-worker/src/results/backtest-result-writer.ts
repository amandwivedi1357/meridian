import type { Decimal, Fill } from "@meridian/core";
import type { BacktestMetrics } from "../metrics/backtest-metrics.js";

export interface SqlQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

export interface BacktestResultWriterDeps {
  readonly execute: (query: SqlQuery) => Promise<void>;
}

export interface BacktestResultRecord {
  readonly runId: string;
  readonly strategy: string;
  readonly symbol: string;
  readonly interval: string;
  readonly fromMs: number;
  readonly toMs: number;
  readonly params: Record<string, unknown>;
  readonly metrics: BacktestMetrics;
  readonly fills: readonly Fill[];
  readonly equityCurve: readonly EquityPoint[];
}

export interface EquityPoint {
  readonly tsMs: number;
  readonly equity: Decimal;
}

export function createBacktestResultWriter(deps: BacktestResultWriterDeps) {
  return {
    async save(record: BacktestResultRecord): Promise<void> {
      validateRecord(record);

      await deps.execute({
        text: `
          INSERT INTO backtest_runs (
            run_id,
            strategy,
            symbol,
            interval,
            from_ms,
            to_ms,
            params,
            metrics
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
          ON CONFLICT (run_id) DO UPDATE SET
            strategy = EXCLUDED.strategy,
            symbol = EXCLUDED.symbol,
            interval = EXCLUDED.interval,
            from_ms = EXCLUDED.from_ms,
            to_ms = EXCLUDED.to_ms,
            params = EXCLUDED.params,
            metrics = EXCLUDED.metrics
        `,
        values: [
          record.runId,
          record.strategy,
          record.symbol,
          record.interval,
          record.fromMs,
          record.toMs,
          JSON.stringify(record.params),
          JSON.stringify(serializeMetrics(record.metrics))
        ]
      });

      if (record.fills.length > 0) {
        await deps.execute(createFillInsert(record.runId, record.fills));
      }

      if (record.equityCurve.length > 0) {
        await deps.execute(createEquityInsert(record.runId, record.equityCurve));
      }
    }
  };
}

function validateRecord(record: BacktestResultRecord): void {
  if (record.runId.trim() === "") {
    throw new Error("Backtest run id is required");
  }
  if (record.strategy.trim() === "") {
    throw new Error("Backtest strategy is required");
  }
  if (record.symbol.trim() === "") {
    throw new Error("Backtest symbol is required");
  }
  if (record.interval.trim() === "") {
    throw new Error("Backtest interval is required");
  }
  if (
    !Number.isSafeInteger(record.fromMs) ||
    !Number.isSafeInteger(record.toMs) ||
    record.fromMs >= record.toMs
  ) {
    throw new Error("Backtest time range must be increasing");
  }
}

function createFillInsert(runId: string, fills: readonly Fill[]): SqlQuery {
  const values: unknown[] = [];
  const rows = fills.map((fill, index) => {
    const offset = index * 9;
    values.push(
      runId,
      index,
      fill.symbol,
      fill.side,
      fill.quantity.toString(),
      fill.price.toString(),
      fill.fee.toString(),
      fill.feeAsset,
      fill.tsMs
    );
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`;
  });

  return {
    text: `
      INSERT INTO backtest_fills (
        run_id,
        fill_index,
        symbol,
        side,
        quantity,
        price,
        fee,
        fee_asset,
        ts_ms
      )
      VALUES ${rows.join(", ")}
      ON CONFLICT (run_id, fill_index) DO UPDATE SET
        symbol = EXCLUDED.symbol,
        side = EXCLUDED.side,
        quantity = EXCLUDED.quantity,
        price = EXCLUDED.price,
        fee = EXCLUDED.fee,
        fee_asset = EXCLUDED.fee_asset,
        ts_ms = EXCLUDED.ts_ms
    `,
    values
  };
}

function createEquityInsert(runId: string, equityCurve: readonly EquityPoint[]): SqlQuery {
  const values: unknown[] = [];
  const rows = equityCurve.map((point, index) => {
    const offset = index * 4;
    values.push(runId, index, point.tsMs, point.equity.toString());
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
  });

  return {
    text: `
      INSERT INTO backtest_equity_points (
        run_id,
        point_index,
        ts_ms,
        equity
      )
      VALUES ${rows.join(", ")}
      ON CONFLICT (run_id, point_index) DO UPDATE SET
        ts_ms = EXCLUDED.ts_ms,
        equity = EXCLUDED.equity
    `,
    values
  };
}

function serializeMetrics(metrics: BacktestMetrics): Record<keyof BacktestMetrics, string | number> {
  return {
    totalReturnPct: metrics.totalReturnPct.toString(),
    cagrPct: metrics.cagrPct.toString(),
    maxDrawdownPct: metrics.maxDrawdownPct.toString(),
    sharpeRatio: metrics.sharpeRatio.toString(),
    sortinoRatio: metrics.sortinoRatio.toString(),
    winRatePct: metrics.winRatePct.toString(),
    profitFactor: metrics.profitFactor.toString(),
    exposurePct: metrics.exposurePct.toString(),
    tradeCount: metrics.tradeCount,
    buyAndHoldReturnPct: metrics.buyAndHoldReturnPct.toString(),
    strategyVsBuyAndHoldPct: metrics.strategyVsBuyAndHoldPct.toString()
  };
}
