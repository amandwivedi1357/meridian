import { Decimal, applySpotFill, type SpotInventory } from "@meridian/core";
import type { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { walletSchema, type WalletReader, type WalletSnapshot } from "./wallet.js";

interface FillRow {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: string;
  price: string;
  fee: string;
  fee_asset: string;
  event_time_ms: string;
}
export interface PortfolioMarket {
  metadata(): Promise<readonly { symbol: string; baseAsset: string; quoteAsset: string }[]>;
  mark(symbol: string): Promise<{ price: string; observedAtMs: number }>;
}
export interface MarkedPosition {
  symbol: string;
  baseAsset: string | null;
  quoteAsset: string | null;
  quantity: string | null;
  avgEntry: string | null;
  costBasis: string | null;
  realizedPnl: string | null;
  unrealizedPnl: string | null;
  marketValue: string | null;
  markPrice: string | null;
  markObservedAtMs: number | null;
  boughtQuantity: string;
  soldQuantity: string;
  buyQuote: string;
  sellQuote: string;
  fillCount: number;
  lastEventTimeMs: number;
  status: "available" | "unavailable";
  reason: string | null;
}
export interface PortfolioSnapshot {
  checkedAt: number;
  scope: "persisted-fills";
  accounting: "weighted-average";
  environment: "testnet" | "production";
  equity: string | null;
  equityReason: string | null;
  equityScope?: "exchange-wallet";
  wallet?: WalletSnapshot;
  status: "available" | "unavailable";
  positions: MarkedPosition[];
  totals: {
    quoteAsset: string;
    realizedPnl: string | null;
    unrealizedPnl: string | null;
    marketValue: string | null;
  }[];
}
export type PortfolioReader = () => Promise<PortfolioSnapshot>;
const amount = z
  .string()
  .max(256)
  .regex(/^-?\d+(\.\d+)?$/);
export const positionSchema = z.object({
  symbol: z.string(),
  baseAsset: z.string().nullable(),
  quoteAsset: z.string().nullable(),
  quantity: amount.nullable(),
  avgEntry: amount.nullable(),
  costBasis: amount.nullable(),
  realizedPnl: amount.nullable(),
  unrealizedPnl: amount.nullable(),
  marketValue: amount.nullable(),
  markPrice: amount.nullable(),
  markObservedAtMs: z.number().int().nullable(),
  boughtQuantity: amount,
  soldQuantity: amount,
  buyQuote: amount,
  sellQuote: amount,
  fillCount: z.number().int().nonnegative(),
  lastEventTimeMs: z.number().int(),
  status: z.enum(["available", "unavailable"]),
  reason: z.string().nullable()
});
export const portfolioSchema = z.object({
  checkedAt: z.number().int(),
  scope: z.literal("persisted-fills"),
  accounting: z.literal("weighted-average"),
  environment: z.enum(["testnet", "production"]),
  equity: amount.nullable(),
  equityReason: z.string().nullable(),
  equityScope: z.literal("exchange-wallet").optional(),
  wallet: walletSchema.optional(),
  status: z.enum(["available", "unavailable"]),
  positions: z.array(positionSchema).max(5),
  totals: z.array(
    z.object({
      quoteAsset: z.string(),
      realizedPnl: amount.nullable(),
      unrealizedPnl: amount.nullable(),
      marketValue: amount.nullable()
    })
  )
});
export function registerPortfolioRoute(server: FastifyInstance, portfolio: PortfolioReader) {
  server.withTypeProvider<ZodTypeProvider>().get(
    "/api/account/portfolio",
    {
      schema: {
        tags: ["Account"],
        response: {
          200: portfolioSchema,
          503: z.object({ error: z.literal("portfolio_unavailable") })
        }
      }
    },
    async (_request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        return await portfolio();
      } catch {
        return reply.code(503).send({ error: "portfolio_unavailable" });
      }
    }
  );
}

export function createPortfolioReader(
  pool: Pick<Pool, "query">,
  market: PortfolioMarket,
  environment: "testnet" | "production",
  now = Date.now,
  walletReader?: WalletReader
): PortfolioReader {
  let pending: Promise<PortfolioSnapshot> | undefined;
  let cached: PortfolioSnapshot | undefined;
  return async () => {
    if (pending) return pending;
    if (cached && now() - cached.checkedAt < 2000) return cached;
    pending = (async (): Promise<PortfolioSnapshot> => {
      const checkedAt = now();
      const result =
        await pool.query<FillRow>(`SELECT symbol,side,quantity::text,price::text,fee::text,fee_asset,event_time_ms::text
        FROM order_fills ORDER BY event_time_ms ASC, trade_id::numeric ASC, client_order_id ASC, execution_id ASC LIMIT 10001`);
      if (result.rows.length > 10000) throw new Error("portfolio_history_capacity");
      const metadata = result.rows.length ? await market.metadata() : [];
      const groups = new Map<string, FillRow[]>();
      for (const fill of result.rows) {
        const rows = groups.get(fill.symbol) ?? [];
        rows.push(fill);
        groups.set(fill.symbol, rows);
      }
      if (groups.size > 5) throw new Error("portfolio_symbol_capacity");
      const positions: MarkedPosition[] = [];
      for (const [symbol, fills] of groups) {
        const m = metadata.find((entry) => entry.symbol === symbol);
        const p: MarkedPosition = {
          symbol,
          baseAsset: m?.baseAsset ?? null,
          quoteAsset: m?.quoteAsset ?? null,
          quantity: null,
          avgEntry: null,
          costBasis: null,
          realizedPnl: null,
          unrealizedPnl: null,
          marketValue: null,
          markPrice: null,
          markObservedAtMs: null,
          boughtQuantity: "0",
          soldQuantity: "0",
          buyQuote: "0",
          sellQuote: "0",
          fillCount: fills.length,
          lastEventTimeMs: Number(fills.at(-1)!.event_time_ms),
          status: "unavailable",
          reason: null
        };
        positions.push(p);
        if (!m || m.baseAsset === m.quoteAsset) {
          p.reason = "symbol_metadata_required";
          continue;
        }
        let inventory: SpotInventory = {
          quantity: new Decimal(0),
          cost: new Decimal(0),
          realizedPnl: new Decimal(0)
        };
        try {
          for (const fill of fills) {
            const time = Number(fill.event_time_ms);
            if (!Number.isSafeInteger(time) || time < 0 || time > checkedAt + 5000)
              throw new Error("invalid_fill");
            const quantity = new Decimal(fill.quantity),
              price = new Decimal(fill.price);
            inventory = applySpotFill(inventory, {
              side: fill.side,
              quantity,
              price,
              fee: new Decimal(fill.fee),
              feeAsset: fill.fee_asset,
              baseAsset: m.baseAsset,
              quoteAsset: m.quoteAsset
            });
            if (fill.side === "BUY") {
              p.boughtQuantity = new Decimal(p.boughtQuantity).plus(quantity).toFixed();
              p.buyQuote = new Decimal(p.buyQuote).plus(quantity.mul(price)).toFixed();
            } else {
              p.soldQuantity = new Decimal(p.soldQuantity).plus(quantity).toFixed();
              p.sellQuote = new Decimal(p.sellQuote).plus(quantity.mul(price)).toFixed();
            }
          }
          p.quantity = inventory.quantity.toFixed();
          p.costBasis = inventory.cost.toFixed();
          p.avgEntry = inventory.quantity.isZero()
            ? "0"
            : inventory.cost.div(inventory.quantity).toFixed();
          p.realizedPnl = inventory.realizedPnl.toFixed();
        } catch (error) {
          const reason = error instanceof Error ? error.message : "invalid_fill";
          p.reason = [
            "opening_cost_basis_required",
            "historical_fee_conversion_required",
            "invalid_net_quantity"
          ].includes(reason)
            ? reason
            : "invalid_fill";
          continue;
        }
        if (inventory.quantity.isZero()) {
          p.marketValue = "0";
          p.unrealizedPnl = "0";
          p.status = "available";
          continue;
        }
        try {
          const mark = await market.mark(symbol),
            price = new Decimal(mark.price);
          if (
            !price.isFinite() ||
            price.lte(0) ||
            !Number.isSafeInteger(mark.observedAtMs) ||
            now() - mark.observedAtMs > 15000 ||
            mark.observedAtMs > now() + 5000
          )
            throw new Error("mark_unavailable");
          p.markPrice = price.toFixed();
          p.markObservedAtMs = mark.observedAtMs;
          p.marketValue = inventory.quantity.mul(price).toFixed();
          p.unrealizedPnl = new Decimal(p.marketValue).minus(inventory.cost).toFixed();
          p.status = "available";
        } catch {
          p.reason = "mark_unavailable";
        }
      }
      const wallet = walletReader ? await walletReader(positions) : undefined;
      // A slow later quote/wallet request must not leave earlier marks labelled fresh.
      for (const position of positions) {
        if (position.markObservedAtMs !== null && now() - position.markObservedAtMs > 15000) {
          position.markPrice = null;
          position.markObservedAtMs = null;
          position.marketValue = null;
          position.unrealizedPnl = null;
          position.status = "unavailable";
          position.reason = "mark_unavailable";
        }
      }
      positions.sort((a, b) => a.symbol.localeCompare(b.symbol));
      const totals = [...new Set(positions.flatMap((p) => (p.quoteAsset ? [p.quoteAsset] : [])))]
        .sort()
        .map((quoteAsset) => {
          const rows = positions.filter((p) => p.quoteAsset === quoteAsset);
          const sum = (field: "realizedPnl" | "unrealizedPnl" | "marketValue") =>
            positions.some((p) => p.quoteAsset === null) || rows.some((p) => p[field] === null)
              ? null
              : rows.reduce((value, p) => value.plus(p[field]!), new Decimal(0)).toFixed();
          return {
            quoteAsset,
            realizedPnl: sum("realizedPnl"),
            unrealizedPnl: sum("unrealizedPnl"),
            marketValue: sum("marketValue")
          };
        });
      cached = {
        checkedAt,
        scope: "persisted-fills",
        accounting: "weighted-average",
        environment,
        equity: wallet?.equity ?? null,
        equityReason: wallet ? wallet.reason : "wallet_snapshot_and_opening_inventory_required",
        ...(wallet ? { wallet, equityScope: "exchange-wallet" as const } : {}),
        positions,
        totals,
        status: positions.some((p) => p.status === "unavailable") ? "unavailable" : "available"
      };
      return cached;
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
