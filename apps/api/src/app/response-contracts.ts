import { Decimal } from "@meridian/core";
import type { FastifyInstance, FastifyError } from "fastify";
import { z } from "zod";
import { portfolioSchema, positionSchema } from "../features/account/portfolio.js";

const time = z.number().int().nonnegative().safe();
const count = z.number().int().nonnegative().safe();
const text = z.string();
const amount = z.preprocess(
  (v) => (v instanceof Decimal ? v.toFixed() : v),
  z
    .string()
    .max(256)
    .regex(/^-?\d+(\.\d+)?$/)
);
const checked = { checkedAt: time };
const control = z.object({ scope: text, engaged: z.boolean(), reason: text, updatedAtMs: time });
const strategy = z.object({
  strategyId: text,
  paused: z.boolean(),
  reason: text,
  updatedAtMs: time
});
const order = z.object({
  clientOrderId: text,
  strategyId: text,
  signalId: text,
  symbol: text,
  side: z.enum(["BUY", "SELL"]),
  type: text,
  state: text,
  quantity: amount,
  limitPrice: amount.nullable(),
  executedQuantity: amount,
  cumulativeQuoteQuantity: amount,
  exchangeOrderId: text.nullable(),
  createdAtMs: time,
  updatedAtMs: time
});
const fill = z.object({
  clientOrderId: text,
  strategyId: text,
  executionId: text,
  tradeId: text,
  symbol: text,
  side: z.enum(["BUY", "SELL"]),
  quantity: amount,
  price: amount,
  fee: amount,
  feeAsset: text,
  eventTimeMs: time
});
const event = z.object({ id: text, tsMs: time, type: text, details: z.unknown() });
const candle = z.object({
  symbol: text,
  interval: text,
  openTimeMs: time,
  closeTimeMs: time,
  open: amount,
  high: amount,
  low: amount,
  close: amount,
  volume: amount,
  closed: z.boolean()
});
const trade = z.object({
  symbol: text,
  tradeId: text,
  price: amount,
  quantity: amount,
  eventTimeMs: time,
  isBuyerMaker: z.boolean()
});
const bookLevel = z.object({ price: amount, quantity: amount });
const json = z.record(z.unknown());
const run = z.object({
  runId: text,
  strategy: text,
  symbol: text,
  interval: text,
  fromMs: text.regex(/^\d+$/),
  toMs: text.regex(/^\d+$/),
  metrics: json,
  createdAt: z.preprocess((v) => (v instanceof Date ? v.toISOString() : v), z.string().datetime())
});
const error = z.object({
  error: text,
  message: text.optional(),
  statusCode: z.number().optional()
});
const success: Record<string, z.ZodTypeAny> = {
  "/api/auth/me": z.object({
    principal: z
      .object({ role: z.enum(["viewer", "operator"]), actor: text, expiresAtMs: time.optional() })
      .nullable()
  }),
  "/api/auth/logout": z.object({ loggedOut: z.literal(true) }),
  "/api/orders": z.object({ ...checked, orders: z.array(order).max(100) }),
  "/api/orders/manual": z.object({
    ...checked,
    stream: z.literal("signals"),
    streamId: text,
    signalId: text,
    strategyId: z.literal("manual"),
    status: z.literal("queued")
  }),
  "/api/orders/:clientOrderId/cancel": z.object({
    ...checked,
    status: z.literal("cancel-requested"),
    order: z.object({
      clientOrderId: text,
      symbol: text,
      state: text,
      exchangeOrderId: text,
      executedQuantity: amount,
      cumulativeQuoteQuantity: amount
    })
  }),
  "/api/fills": z.object({ ...checked, fills: z.array(fill).max(100) }),
  "/api/fills/report": z.object({
    ...checked,
    complete: z.boolean(),
    fills: z.array(fill).max(10000)
  }),
  "/api/risk/events": z.object({ ...checked, events: z.array(event).max(100) }),
  "/api/strategies": z.object({ ...checked, strategies: z.array(strategy).max(100) }),
  "/api/trading/state": z.object({
    ...checked,
    orders: z.array(order).max(100),
    fills: z.array(fill).max(100),
    riskEvents: z.array(event).max(100),
    riskControl: control.nullable(),
    strategies: z.array(strategy).max(100)
  }),
  "/api/risk/state": z.object({
    ...checked,
    control: control.nullable(),
    equity: z
      .array(
        z.object({
          scope: text,
          quoteAsset: text,
          peak: amount,
          updatedAtMs: time
        })
      )
      .max(20)
  }),
  "/api/risk/kill-switch/engage": z.object({
    ...checked,
    redisUpdated: z.boolean(),
    riskControl: control
  }),
  "/api/strategies/:strategyId/pause": z.object({ ...checked, strategy }),
  "/api/strategies/:strategyId/resume": z.object({ ...checked, strategy }),
  "/api/positions": portfolioSchema,
  "/api/account/summary": z.object({
    ...checked,
    orderCount: count,
    fillCount: count,
    ordersByState: z.record(count),
    riskControl: control.nullable(),
    positions: z.array(positionSchema).max(5),
    portfolio: portfolioSchema
  }),
  "/api/market/candles": z.object({
    ...checked,
    symbol: text,
    interval: text,
    candles: z.array(candle).max(500)
  }),
  "/api/market/instruments": z.object({
    ...checked,
    quoteAsset: text,
    instruments: z
      .array(
        z.object({
          symbol: text,
          baseAsset: text,
          quoteAsset: text,
          status: text
        })
      )
      .max(500)
  }),
  "/api/market/snapshot": z.object({
    ...checked,
    symbol: text,
    interval: text,
    cursor: text,
    candles: z.array(candle).max(200),
    trades: z.array(trade).max(200),
    book: z.object({
      symbol: text,
      eventTimeMs: time,
      lastUpdateId: time,
      depthLimit: count,
      complete: z.literal(false),
      bids: z.array(bookLevel),
      asks: z.array(bookLevel)
    })
  }),
  "/api/backtests": z.object({ runs: z.array(run).max(100) }),
  "/api/backtests/:runId": z.object({ run: run.extend({ params: json }) }),
  "/api/backtests/:runId/fills": z.object({
    items: z
      .array(
        z.object({
          index: count,
          symbol: text,
          side: z.enum(["BUY", "SELL"]),
          quantity: amount,
          price: amount,
          fee: amount,
          feeAsset: text,
          tsMs: text.regex(/^\d+$/)
        })
      )
      .max(1000),
    nextCursor: count.nullable()
  }),
  "/api/backtests/:runId/equity": z.object({
    items: z.array(z.object({ index: count, tsMs: text.regex(/^\d+$/), equity: amount })).max(1000),
    nextCursor: count.nullable()
  }),
  "/api/dashboard": z.object({
    ...checked,
    symbol: text,
    source: text,
    feed: z.enum(["live", "stale", "waiting"]),
    trades: z
      .array(
        z.object({ id: text, time, price: amount, quantity: amount, side: z.enum(["buy", "sell"]) })
      )
      .max(500),
    redis: z.object({
      available: z.boolean(),
      count: count.nullable(),
      memoryBytes: count.nullable()
    }),
    database: z.object({
      available: z.boolean(),
      count: count.nullable(),
      checkedAt: time.nullable()
    }),
    recording: z
      .object({ bytes: count, updatedAt: z.number(), startedAt: z.number(), path: text })
      .nullable(),
    soak: z.object({
      status: z.enum(["attention", "finished", "running"]),
      startedAt: z.number().nullable(),
      elapsedMs: z.number().nonnegative(),
      durationMs: count,
      progress: z.number().min(0).max(1),
      completed: z.boolean(),
      hasErrors: z.boolean()
    })
  })
};

export function registerResponseContracts(server: FastifyInstance) {
  server.addHook("onRoute", (route) => {
    if (
      !route.url.startsWith("/api/") ||
      route.url.startsWith("/api/stream/") ||
      route.url === "/api/openapi.json"
    )
      return;
    route.schema ??= {};
    const responses: Record<string, unknown> = {
      ...(route.schema.response as Record<string, unknown> | undefined)
    };
    if (success[route.url]) responses[200] ??= success[route.url];
    for (const code of [400, 401, 403, 404, 409, 429, 500, 503]) responses[code] ??= error;
    route.schema.response = responses;
  });
  server.setErrorHandler<FastifyError>((failure, request, reply) => {
    if (failure.code === "FST_ERR_RESPONSE_SERIALIZATION") {
      request.log.error({ route: request.routeOptions.url }, "API response contract violation");
      return reply
        .code(500)
        .send({ error: "response_contract_violation", message: "API response is unavailable" });
    }
    const status = failure.statusCode ?? 500;
    return reply.code(status).send({
      error: status >= 500 ? "internal_server_error" : failure.name,
      message: status >= 500 ? "Request could not be completed" : failure.message,
      statusCode: status
    });
  });
}
