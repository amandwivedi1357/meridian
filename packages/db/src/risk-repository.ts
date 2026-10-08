import type { OrderWriteAheadRepositoryDeps } from "./order-write-ahead-repository.js";

export interface RiskSqlDatabase extends OrderWriteAheadRepositoryDeps {
  readonly transaction: <T>(work: (db: OrderWriteAheadRepositoryDeps) => Promise<T>) => Promise<T>;
}
export interface RiskReservation {
  signalId: string;
  strategyId: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: string;
  notional: string;
  reservedAtMs: number;
  validUntilMs: number;
}
export function createRiskRepository(db: RiskSqlDatabase) {
  function scoped(sql: OrderWriteAheadRepositoryDeps) {
    async function rows(text: string, values: readonly unknown[] = []) {
      const result = await sql.execute({ text, values });
      if (!Array.isArray(result.rows)) throw new Error("Risk query rows unavailable");
      return result.rows as readonly Record<string, unknown>[];
    }
    return {
      async getKillState() {
        const [row] = await rows(
          "SELECT engaged, reason FROM risk_control_state WHERE scope = 'global'"
        );
        if (row === undefined || typeof row.engaged !== "boolean" || typeof row.reason !== "string")
          throw new Error("Kill state unavailable");
        return { engaged: row.engaged, reason: row.reason };
      },
      async setKillState(engaged: boolean, reason: string, actor: string) {
        if (!reason.trim() || !actor.trim())
          throw new Error("Kill action requires reason and actor");
        await sql
          .execute({
            text: `WITH changed AS (
          UPDATE risk_control_state SET engaged = $1, reason = $2, updated_at = now()
          WHERE scope = 'global' RETURNING scope
        ) INSERT INTO audit_log (actor, action, details)
          SELECT $3, $4, jsonb_build_object('reason', $2::text) FROM changed`,
            values: [engaged, reason, actor, engaged ? "kill-switch-engaged" : "kill-switch-reset"]
          })
          .then((result) => {
            if (result.rowCount !== 1) throw new Error("Kill state update unavailable");
          });
      },
      async recordEvent(type: string, details: Record<string, unknown>) {
        await sql
          .execute({
            text: "INSERT INTO risk_events (type, details) VALUES ($1, $2::jsonb)",
            values: [type, JSON.stringify(details)]
          })
          .then((result) => {
            if (result.rowCount !== 1) throw new Error("Risk event persistence failed");
          });
      },
      async updatePeak(equity: string, quoteAsset = "USDT"): Promise<string> {
        const [row] = await rows(
          `INSERT INTO risk_equity_state (scope, peak, quote_asset) VALUES ('global', $1::numeric, $2)
          ON CONFLICT (scope) DO UPDATE SET peak = greatest(risk_equity_state.peak, EXCLUDED.peak), updated_at = now()
          WHERE risk_equity_state.quote_asset = EXCLUDED.quote_asset
          RETURNING peak::text`,
          [equity, quoteAsset]
        );
        if (typeof row?.peak !== "string") throw new Error("Equity peak unavailable");
        return row.peak;
      },
      async listFills() {
        return rows(`SELECT f.*, o.strategy_id FROM order_fills f JOIN orders o USING (client_order_id)
          ORDER BY f.event_time_ms, f.client_order_id, f.execution_id`);
      },
      async listActiveReservations(nowMs: number) {
        return rows(
          `SELECT r.* FROM risk_reservations r WHERE r.valid_until_ms > $1 OR EXISTS (
          SELECT 1 FROM orders o WHERE o.signal_id = r.signal_id AND o.strategy_id = r.strategy_id
          AND o.state IN ('PENDING_NEW', 'UNKNOWN', 'NEW', 'PARTIALLY_FILLED', 'PENDING_CANCEL'))`,
          [nowMs]
        );
      },
      async countRecentReservations(strategyId: string, nowMs: number) {
        const [row] = await rows(
          `SELECT count(*)::text AS count FROM risk_reservations
          WHERE strategy_id = $1 AND reserved_at_ms > $2`,
          [strategyId, nowMs - 60_000]
        );
        const count = Number(row?.count);
        if (!Number.isSafeInteger(count) || count < 0) throw new Error("Order rate unavailable");
        return count;
      },
      async reserve(record: RiskReservation) {
        const result = await sql.execute({
          text: `INSERT INTO risk_reservations
          (signal_id, strategy_id, symbol, side, quantity, notional, reserved_at_ms, valid_until_ms)
          VALUES ($1,$2,$3,$4,$5::numeric,$6::numeric,$7,$8) ON CONFLICT DO NOTHING`,
          values: [
            record.signalId,
            record.strategyId,
            record.symbol,
            record.side,
            record.quantity,
            record.notional,
            record.reservedAtMs,
            record.validUntilMs
          ]
        });
        if (result.rowCount !== 1) throw new Error("Risk reservation identity already exists");
      }
    };
  }
  return {
    ...scoped(db),
    async locked<T>(work: (repo: ReturnType<typeof scoped>) => Promise<T>) {
      return db.transaction(async (tx) => {
        // All approvals and manual control changes share one cross-process lock.
        await tx.execute({ text: "SELECT pg_advisory_xact_lock(3140034)", values: [] });
        return work(scoped(tx));
      });
    }
  };
}
export type RiskRepository = ReturnType<typeof createRiskRepository>;
export type LockedRiskRepository = Parameters<Parameters<RiskRepository["locked"]>[0]>[0];
