import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { Decimal, serializeSignal, type OrderType, type Side } from "@meridian/core";

import { currentPrincipal, requireOperator } from "../../app/auth.js";

const signalsStream = "signals";

interface ManualOrderRedis {
  readonly sendCommand: (args: readonly string[]) => Promise<unknown>;
}

interface ManualOrderRequest {
  readonly symbol: string;
  readonly side: Side;
  readonly type: Extract<OrderType, "MARKET" | "LIMIT">;
  readonly quantity: Decimal;
  readonly limitPrice?: Decimal;
  readonly reason: string;
}

export function registerManualOrderRoute(
  server: FastifyInstance,
  pool: Pool,
  redis: ManualOrderRedis
): void {
  server.post("/api/orders/manual", { preHandler: requireOperator() }, async (request, reply) => {
    const order = readManualOrder(request.body);
    if (order === null) {
      return reply.code(400).send({
        error: "invalid_manual_order",
        message: "Manual order requires symbol, side, type, quantity, reason and confirmation"
      });
    }

    const actor = currentPrincipal(request)?.actor ?? "unknown-api-operator";
    const now = Date.now();
    const signalId = `manual_${now}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const signal = {
      signalId,
      strategyId: "manual",
      createdAtMs: now,
      validUntilMs: now + 30_000,
      intent: {
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        quantity: order.quantity,
        ...(order.limitPrice === undefined ? {} : { limitPrice: order.limitPrice }),
        reason: `manual:${order.reason}`
      }
    };
    const payload = JSON.stringify(serializeSignal(signal));

    try {
      await pool.query(
        `
            INSERT INTO audit_log (actor, action, details)
            VALUES (
              $1,
              'api-manual-order-requested',
              jsonb_build_object(
                'signalId', $2::text,
                'symbol', $3::text,
                'side', $4::text,
                'type', $5::text,
                'quantity', $6::text,
                'limitPrice', $7::text,
                'reason', $8::text
              )
            )
          `,
        [
          actor,
          signal.signalId,
          order.symbol,
          order.side,
          order.type,
          order.quantity.toFixed(),
          order.limitPrice?.toFixed() ?? null,
          order.reason
        ]
      );
      const streamId = await redis.sendCommand([
        "XADD",
        signalsStream,
        "*",
        "kind",
        "signal",
        "signalId",
        signal.signalId,
        "payload",
        payload
      ]);
      if (typeof streamId !== "string") throw new Error("Redis XADD returned invalid id");

      return {
        checkedAt: Date.now(),
        stream: signalsStream,
        streamId,
        signalId: signal.signalId,
        strategyId: signal.strategyId,
        status: "queued"
      };
    } catch {
      return reply.code(503).send({
        error: "manual_order_unavailable",
        message: "Manual order could not be queued"
      });
    }
  });
}

function readManualOrder(body: FastifyRequest["body"]): ManualOrderRequest | null {
  if (body === null || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (record.confirm !== "QUEUE_MANUAL_ORDER") return null;
  const symbol = readSymbol(record.symbol);
  const side = readSide(record.side);
  const type = readType(record.type);
  const quantity = readPositiveDecimal(record.quantity);
  const reason = readReason(record.reason);
  if (!symbol || !side || !type || !quantity || !reason) return null;
  const maybeLimitPrice =
    record.limitPrice === undefined || record.limitPrice === null || record.limitPrice === ""
      ? undefined
      : readPositiveDecimal(record.limitPrice);
  if (maybeLimitPrice === null) return null;
  if (type === "LIMIT" && maybeLimitPrice === undefined) return null;
  if (type === "MARKET" && maybeLimitPrice !== undefined) return null;
  return {
    symbol,
    side,
    type,
    quantity,
    ...(maybeLimitPrice === undefined ? {} : { limitPrice: maybeLimitPrice }),
    reason
  };
}

function readSymbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const symbol = value.trim().toUpperCase();
  return /^[A-Z0-9]{2,30}$/.test(symbol) ? symbol : null;
}

function readSide(value: unknown): Side | null {
  return value === "BUY" || value === "SELL" ? value : null;
}

function readType(value: unknown): Extract<OrderType, "MARKET" | "LIMIT"> | null {
  return value === "MARKET" || value === "LIMIT" ? value : null;
}

function readPositiveDecimal(value: unknown): Decimal | null {
  if (typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value) || value.length > 64) return null;
  const decimal = new Decimal(value);
  return decimal.isFinite() && decimal.gt(0) ? decimal : null;
}

function readReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  return reason !== "" && reason.length <= 300 ? reason : null;
}
