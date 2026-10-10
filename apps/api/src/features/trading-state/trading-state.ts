import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

interface OrderRow {
  readonly client_order_id: string;
  readonly strategy_id: string;
  readonly signal_id: string;
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly type: "MARKET" | "LIMIT";
  readonly state: string;
  readonly quantity: string;
  readonly limit_price: string | null;
  readonly executed_quantity: string;
  readonly cumulative_quote_quantity: string;
  readonly exchange_order_id: string | null;
  readonly created_at_ms: string;
  readonly updated_at_ms: string;
}

interface FillRow {
  readonly client_order_id: string;
  readonly strategy_id: string;
  readonly execution_id: string;
  readonly trade_id: string;
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: string;
  readonly price: string;
  readonly fee: string;
  readonly fee_asset: string;
  readonly event_time_ms: string;
}

interface RiskEventRow {
  readonly id: string;
  readonly ts_ms: string;
  readonly type: string;
  readonly details: unknown;
}

interface RiskControlRow {
  readonly scope: string;
  readonly engaged: boolean;
  readonly reason: string;
  readonly updated_at_ms: string;
}

interface StrategyControlRow {
  readonly strategy_id: string;
  readonly paused: boolean;
  readonly reason: string;
  readonly updated_at_ms: string;
}

export function registerTradingState(server: FastifyInstance, pool: Pool): void {
  server.get("/api/trading/state", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const limit = readLimit(request.query);

    try {
      const [orders, fills, riskEvents, riskControl, strategies] = await Promise.all([
        pool.query<OrderRow>(
          `
            SELECT
              client_order_id,
              strategy_id,
              signal_id,
              symbol,
              side,
              type,
              state,
              quantity::text,
              limit_price::text,
              executed_quantity::text,
              cumulative_quote_quantity::text,
              exchange_order_id,
              (EXTRACT(EPOCH FROM created_at) * 1000)::bigint::text AS created_at_ms,
              (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint::text AS updated_at_ms
            FROM orders
            ORDER BY updated_at DESC
            LIMIT $1
          `,
          [limit]
        ),
        pool.query<FillRow>(
          `
            SELECT
              f.client_order_id,
              o.strategy_id,
              f.execution_id,
              f.trade_id,
              f.symbol,
              f.side,
              f.quantity::text,
              f.price::text,
              f.fee::text,
              f.fee_asset,
              f.event_time_ms::text
            FROM order_fills f
            JOIN orders o USING (client_order_id)
            ORDER BY f.event_time_ms DESC
            LIMIT $1
          `,
          [limit]
        ),
        pool.query<RiskEventRow>(
          `
            SELECT
              id::text,
              (EXTRACT(EPOCH FROM ts) * 1000)::bigint::text AS ts_ms,
              type,
              details
            FROM risk_events
            ORDER BY ts DESC
            LIMIT $1
          `,
          [limit]
        ),
        pool.query<RiskControlRow>(
          `
            SELECT
              scope,
              engaged,
              reason,
              (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint::text AS updated_at_ms
            FROM risk_control_state
            WHERE scope = 'global'
            LIMIT 1
          `
        ),
        pool.query<StrategyControlRow>(
          `
            SELECT
              strategy_id,
              paused,
              reason,
              (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint::text AS updated_at_ms
            FROM strategy_control_state
            ORDER BY updated_at DESC
          `
        )
      ]);

      return {
        checkedAt: Date.now(),
        orders: orders.rows.map(toOrder),
        fills: fills.rows.map(toFill),
        riskEvents: riskEvents.rows.map(toRiskEvent),
        riskControl:
          riskControl.rows[0] === undefined ? null : toRiskControl(riskControl.rows[0]),
        strategies: strategies.rows.map(toStrategyControl)
      };
    } catch {
      return reply.code(503).send({
        error: "trading_state_unavailable",
        message: "Trading state is unavailable"
      });
    }
  });
}

function readLimit(query: unknown): number {
  const raw =
    query !== null &&
    typeof query === "object" &&
    "limit" in query &&
    typeof query.limit === "string"
      ? Number(query.limit)
      : 50;

  if (!Number.isSafeInteger(raw) || raw <= 0) return 50;
  return Math.min(raw, 100);
}

function toOrder(row: OrderRow) {
  return {
    clientOrderId: row.client_order_id,
    strategyId: row.strategy_id,
    signalId: row.signal_id,
    symbol: row.symbol,
    side: row.side,
    type: row.type,
    state: row.state,
    quantity: row.quantity,
    limitPrice: row.limit_price,
    executedQuantity: row.executed_quantity,
    cumulativeQuoteQuantity: row.cumulative_quote_quantity,
    exchangeOrderId: row.exchange_order_id,
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms)
  };
}

function toFill(row: FillRow) {
  return {
    clientOrderId: row.client_order_id,
    strategyId: row.strategy_id,
    executionId: row.execution_id,
    tradeId: row.trade_id,
    symbol: row.symbol,
    side: row.side,
    quantity: row.quantity,
    price: row.price,
    fee: row.fee,
    feeAsset: row.fee_asset,
    eventTimeMs: Number(row.event_time_ms)
  };
}

function toRiskEvent(row: RiskEventRow) {
  return {
    id: row.id,
    tsMs: Number(row.ts_ms),
    type: row.type,
    details: row.details
  };
}

function toRiskControl(row: RiskControlRow) {
  return {
    scope: row.scope,
    engaged: row.engaged,
    reason: row.reason,
    updatedAtMs: Number(row.updated_at_ms)
  };
}

function toStrategyControl(row: StrategyControlRow) {
  return {
    strategyId: row.strategy_id,
    paused: row.paused,
    reason: row.reason,
    updatedAtMs: Number(row.updated_at_ms)
  };
}
