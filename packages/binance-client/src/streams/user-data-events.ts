import { Decimal } from "@meridian/core";
import { z } from "zod";
import { orderResponseSchema } from "../rest/order-schemas.js";

const time = z.number().int().safe().nonnegative();
const amount = z
  .string()
  .max(100)
  .regex(/^\d+(?:\.\d+)?$/);
const signedAmount = z
  .string()
  .max(100)
  .regex(/^-?\d+(?:\.\d+)?$/);
const asset = z.string().min(1).max(30);
const header = z.object({ subscriptionId: time, event: z.object({ e: z.string(), E: time }) });
const account = z.object({
  e: z.literal("outboundAccountPosition"),
  E: time,
  u: time,
  B: z.array(z.object({ a: asset, f: amount, l: amount }))
});
const balance = z.object({
  e: z.literal("balanceUpdate"),
  E: time,
  a: asset,
  d: signedAmount,
  T: time
});
const execution = z.object({
  e: z.literal("executionReport"),
  E: time,
  T: time,
  s: z.string().min(1),
  c: z.string().min(1),
  C: z.string().optional(),
  S: z.enum(["BUY", "SELL"]),
  o: orderResponseSchema.shape.type,
  x: z.enum(["NEW", "CANCELED", "REPLACED", "REJECTED", "TRADE", "EXPIRED", "TRADE_PREVENTION"]),
  X: orderResponseSchema.shape.status,
  i: time,
  I: time,
  q: amount,
  p: amount,
  l: amount,
  L: amount,
  z: amount,
  Z: amount,
  n: amount,
  N: asset.nullable(),
  t: z.number().int().safe().min(-1),
  m: z.boolean()
});

export interface UserDataAccountUpdate {
  readonly kind: "account-update";
  readonly subscriptionId: number;
  readonly eventTimeMs: number;
  readonly updateTimeMs: number;
  readonly balances: readonly {
    readonly asset: string;
    readonly free: Decimal;
    readonly locked: Decimal;
  }[];
}

export interface UserDataBalanceUpdate {
  readonly kind: "balance-update";
  readonly subscriptionId: number;
  readonly eventTimeMs: number;
  readonly clearTimeMs: number;
  readonly asset: string;
  readonly delta: Decimal;
}

export interface UserDataOrderUpdate {
  readonly kind: "order-update";
  readonly subscriptionId: number;
  readonly eventTimeMs: number;
  readonly transactionTimeMs: number;
  readonly symbol: string;
  readonly clientOrderId: string;
  readonly originalClientOrderId: string | undefined;
  readonly orderId: string;
  readonly executionId: string;
  readonly tradeId: string | undefined;
  readonly side: "BUY" | "SELL";
  readonly type: z.infer<typeof execution>["o"];
  readonly status: z.infer<typeof execution>["X"];
  readonly executionType: z.infer<typeof execution>["x"];
  readonly quantity: Decimal;
  readonly price: Decimal;
  readonly lastQuantity: Decimal;
  readonly lastPrice: Decimal;
  readonly executedQuantity: Decimal;
  readonly cumulativeQuoteQuantity: Decimal;
  readonly commission: Decimal;
  readonly commissionAsset: string | null;
  readonly maker: boolean;
}

export type UserDataEvent = UserDataAccountUpdate | UserDataBalanceUpdate | UserDataOrderUpdate;

export function parseUserDataEvent(value: unknown): UserDataEvent | undefined {
  const envelope = header.safeParse(value);
  if (!envelope.success) throw new Error("Invalid user-data event envelope");
  const { subscriptionId } = envelope.data;
  const raw = (value as { event: unknown }).event;
  switch (envelope.data.event.e) {
    case "outboundAccountPosition": {
      const parsed = account.safeParse(raw);
      if (!parsed.success) throw new Error("Invalid account update");
      const event = parsed.data;
      return {
        kind: "account-update",
        subscriptionId,
        eventTimeMs: event.E,
        updateTimeMs: event.u,
        balances: event.B.map((item) => ({
          asset: item.a,
          free: new Decimal(item.f),
          locked: new Decimal(item.l)
        }))
      };
    }
    case "balanceUpdate": {
      const parsed = balance.safeParse(raw);
      if (!parsed.success) throw new Error("Invalid balance update");
      const event = parsed.data;
      return {
        kind: "balance-update",
        subscriptionId,
        eventTimeMs: event.E,
        clearTimeMs: event.T,
        asset: event.a,
        delta: new Decimal(event.d)
      };
    }
    case "executionReport": {
      const parsed = execution.safeParse(raw);
      if (!parsed.success) throw new Error("Invalid execution report");
      const event = parsed.data;
      const lastQuantity = new Decimal(event.l);
      const lastPrice = new Decimal(event.L);
      const commission = new Decimal(event.n);
      if (
        event.x === "TRADE" &&
        (event.t < 0 ||
          lastQuantity.lte(0) ||
          lastPrice.lte(0) ||
          (commission.gt(0) && event.N === null))
      ) {
        throw new Error("Invalid trade execution report");
      }
      return {
        kind: "order-update",
        subscriptionId,
        eventTimeMs: event.E,
        transactionTimeMs: event.T,
        symbol: event.s,
        clientOrderId: event.c,
        originalClientOrderId: event.C || undefined,
        orderId: String(event.i),
        executionId: String(event.I),
        tradeId: event.t < 0 ? undefined : String(event.t),
        side: event.S,
        type: event.o,
        status: event.X,
        executionType: event.x,
        quantity: new Decimal(event.q),
        price: new Decimal(event.p),
        lastQuantity,
        lastPrice,
        executedQuantity: new Decimal(event.z),
        cumulativeQuoteQuantity: new Decimal(event.Z),
        commission,
        commissionAsset: event.N,
        maker: event.m
      };
    }
    default:
      return undefined;
  }
}
