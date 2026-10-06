import { z } from "zod";

const symbolSchema = z.string().regex(/^[A-Z0-9]{2,30}$/);
// Conservative prototype subset; deterministic ID generation belongs to Phase 3.2.
const clientOrderIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,36}$/);
const decimalSchema = z
  .string()
  .max(100)
  .regex(/^\d+(?:\.\d+)?$/);
const positiveDecimalSchema = decimalSchema.refine((value) => /[1-9]/.test(value));
const sideSchema = z.enum(["BUY", "SELL"]);
const timeInForceSchema = z.enum(["GTC", "IOC", "FOK"]);
const timestampSchema = z.number().int().safe().nonnegative();

const commonOrderFields = {
  symbol: symbolSchema,
  side: sideSchema,
  quantity: positiveDecimalSchema,
  clientOrderId: clientOrderIdSchema
};

export const placeOrderSchema = z.discriminatedUnion("type", [
  z.object({ ...commonOrderFields, type: z.literal("MARKET") }).strict(),
  z
    .object({
      ...commonOrderFields,
      type: z.literal("LIMIT"),
      price: positiveDecimalSchema,
      timeInForce: timeInForceSchema
    })
    .strict()
]);

export const orderLookupSchema = z
  .object({
    symbol: symbolSchema,
    clientOrderId: clientOrderIdSchema
  })
  .strict();

export const openOrdersSchema = z.object({ symbol: symbolSchema.optional() }).strict();

export const orderResponseSchema = z.object({
  symbol: symbolSchema,
  orderId: timestampSchema,
  orderListId: z.number().int().safe().min(-1),
  clientOrderId: z.string().min(1).max(36),
  origClientOrderId: z.string().min(1).max(36).optional(),
  price: decimalSchema,
  origQty: decimalSchema,
  executedQty: decimalSchema,
  // Binance may return negative cumulative quote quantities for historical orders.
  cummulativeQuoteQty: z
    .string()
    .max(100)
    .regex(/^-?\d+(?:\.\d+)?$/),
  status: z.enum([
    "NEW",
    "PENDING_NEW",
    "PARTIALLY_FILLED",
    "FILLED",
    "CANCELED",
    "PENDING_CANCEL",
    "REJECTED",
    "EXPIRED",
    "EXPIRED_IN_MATCH"
  ]),
  timeInForce: timeInForceSchema,
  type: z.enum([
    "MARKET",
    "LIMIT",
    "LIMIT_MAKER",
    "STOP_LOSS",
    "STOP_LOSS_LIMIT",
    "TAKE_PROFIT",
    "TAKE_PROFIT_LIMIT"
  ]),
  side: sideSchema,
  transactTime: timestampSchema.optional(),
  time: timestampSchema.optional(),
  updateTime: timestampSchema.optional(),
  fills: z
    .array(
      z.object({
        price: decimalSchema,
        qty: decimalSchema,
        commission: decimalSchema,
        commissionAsset: z.string().min(1),
        tradeId: timestampSchema.optional()
      })
    )
    .optional()
});

export type PlaceOrderParams = z.infer<typeof placeOrderSchema>;
export type OrderLookupParams = z.infer<typeof orderLookupSchema>;
export type OpenOrdersParams = z.infer<typeof openOrdersSchema>;
export type BinanceOrderResponse = z.infer<typeof orderResponseSchema>;
