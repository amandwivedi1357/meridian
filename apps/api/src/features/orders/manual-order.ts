import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { Decimal, serializeSignal, type OrderType, type Side } from "@meridian/core";

import { currentPrincipal, requireOperator } from "../../app/auth.js";

const signalsStream = "signals";

interface ManualOrderRedis {
  readonly sendCommand: (args: readonly string[]) => Promise<unknown>;
}

interface ManualOrderRequest {
  readonly requestId: string;
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
    const signalId = `manual_${createHash("sha256").update(`${actor}:${order.requestId}`).digest("hex").slice(0, 32)}`;
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
    let payload = JSON.stringify(serializeSignal(signal));
    const fingerprint = JSON.stringify({
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      quantity: order.quantity.toFixed(),
      limitPrice: order.limitPrice?.toFixed() ?? null,
      reason: order.reason
    });

    try {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout = '2s'");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [signalId]);
        const previous = await client.query<{ details: { fingerprint: string; payload: string } }>(
          "SELECT details FROM audit_log WHERE actor=$1 AND action='api-manual-order-requested' AND details->>'requestId'=$2 ORDER BY id LIMIT 1",
          [actor, order.requestId]
        );
        if (previous.rows[0]) {
          if (previous.rows[0].details.fingerprint !== fingerprint) {
            await client.query("ROLLBACK");
            return reply.code(409).send({
              error: "manual_request_conflict",
              message: "Request identity already belongs to a different order"
            });
          }
          payload = previous.rows[0].details.payload;
        } else {
          await client.query(
            "INSERT INTO audit_log (actor, action, details) VALUES ($1, 'api-manual-order-requested', $2::jsonb)",
            [
              actor,
              JSON.stringify({
                requestId: order.requestId,
                signalId,
                fingerprint,
                payload,
                symbol: order.symbol,
                side: order.side,
                type: order.type,
                quantity: order.quantity.toFixed(),
                limitPrice: order.limitPrice?.toFixed() ?? null,
                reason: order.reason
              })
            ]
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
      // Re-publication may duplicate a stream entry, never the stable Executor order identity.
      // Preserve the original expiry even after response loss or an API restart.
      if (JSON.parse(payload).validUntilMs <= Date.now())
        return reply.code(409).send({
          error: "manual_request_expired",
          message: "Request expired; inspect its order status before creating a new request"
        });
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
        message: "Queue outcome is unconfirmed; retry the same request identity"
      });
    }
  });
}

function readManualOrder(body: FastifyRequest["body"]): ManualOrderRequest | null {
  if (body === null || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (
    typeof record.requestId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(record.requestId)
  )
    return null;
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
    requestId: record.requestId.toLowerCase(),
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
