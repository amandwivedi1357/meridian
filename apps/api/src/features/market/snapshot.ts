import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  createLocalDepthSync,
  parseDepthResponse,
  type BinanceDepthResponse
} from "@meridian/binance-client";
import type { MarketEventMessage } from "@meridian/proto";
import type { StreamSource, StreamTopic } from "../streams/stream-source.js";
import type { ChartInterval } from "./recent-history.js";

export interface BootstrapSource extends StreamSource {
  captureMarket(topic: StreamTopic): Promise<{ cursor: string; events: MarketEventMessage[] }>;
}
const decimal = z
  .string()
  .max(64)
  .regex(/^\d+(\.\d+)?$/);
const depthSchema = z.object({
  lastUpdateId: z.number().int().nonnegative().safe(),
  bids: z.array(z.tuple([decimal, decimal])).max(100),
  asks: z.array(z.tuple([decimal, decimal])).max(100)
});

export async function bootstrapMarket(
  source: BootstrapSource,
  topic: StreamTopic,
  loadDepth: () => Promise<BinanceDepthResponse>
): Promise<{
  cursor: string;
  events: MarketEventMessage[];
  book: ReturnType<typeof parseDepthResponse> & {
    lastUpdateId: number;
    depthLimit: number;
    complete: boolean;
  };
}> {
  const captured = await source.captureMarket(topic);
  const depth = depthSchema.parse(await loadDepth());
  if (!Number.isSafeInteger(depth.lastUpdateId) || depth.lastUpdateId < 0)
    throw new Error("invalid_book_snapshot");
  const sync = createLocalDepthSync({
    book: parseDepthResponse(topic.symbol, depth, Date.now()),
    lastUpdateId: depth.lastUpdateId
  });
  let cursor = captured.cursor;
  const events = [...captured.events];
  // Bounded catch-up: no snapshot is returned until a Redis delta bridges the REST update ID.
  for (let attempt = 0; attempt < 20; attempt++) {
    const batch = await source.read(topic, cursor);
    for (const event of batch.events as MarketEventMessage[]) {
      if (event.kind !== "depth") {
        events.push(event);
        continue;
      }
      if (Date.now() - event.occurredAtMs > 15000 || event.occurredAtMs > Date.now() + 5000)
        throw new Error("market_feed_stale");
      const state = sync.applyDepthEvent({
        e: "depthUpdate",
        E: event.occurredAtMs,
        s: topic.symbol,
        U: event.depth.firstUpdateId,
        u: event.depth.finalUpdateId,
        b: event.depth.bids.map(
          (level) => [level.price.toFixed(), level.quantity.toFixed()] as const
        ),
        a: event.depth.asks.map(
          (level) => [level.price.toFixed(), level.quantity.toFixed()] as const
        )
      }).state;
      if (state.status === "NEEDS_RESYNC") throw new Error("book_gap_resync_required");
    }
    cursor = batch.cursor;
    if (events.length > 1000 || Buffer.byteLength(JSON.stringify(events)) > 512 * 1024)
      throw new Error("snapshot_capacity");
    if (sync.getState().status === "SYNCED")
      return {
        cursor,
        events,
        book: {
          ...sync.snapshot(),
          lastUpdateId: sync.getState().lastAppliedUpdateId,
          depthLimit: 100,
          complete: false
        }
      };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("book_bridge_unavailable");
}

export function registerMarketSnapshot(
  server: FastifyInstance,
  pool: Pool,
  source: BootstrapSource,
  loadDepth: (symbol: string) => Promise<BinanceDepthResponse>,
  loadHistory?: (
    symbol: string,
    interval: ChartInterval
  ) => Promise<
    readonly {
      symbol: string;
      interval: string;
      openTimeMs: number;
      closeTimeMs: number;
      open: string;
      high: string;
      low: string;
      close: string;
      volume: string;
      closed: boolean;
    }[]
  >
) {
  const pending = new Map<string, Promise<unknown>>();
  const fallbackSnapshot = async (
    topic: StreamTopic,
    recent: Awaited<ReturnType<NonNullable<typeof loadHistory>>>
  ) => {
    const depth = depthSchema.parse(await loadDepth(topic.symbol));
    if (!Number.isSafeInteger(depth.lastUpdateId) || depth.lastUpdateId < 0)
      throw new Error("invalid_book_snapshot");
    return {
      checkedAt: Date.now(),
      symbol: topic.symbol,
      interval: topic.interval,
      cursor: "",
      book: {
        ...parseDepthResponse(topic.symbol, depth, Date.now()),
        lastUpdateId: depth.lastUpdateId,
        depthLimit: 100,
        complete: false
      },
      trades: [],
      candles: [...recent].sort((a, b) => a.openTimeMs - b.openTimeMs).slice(-200)
    };
  };
  server.withTypeProvider<ZodTypeProvider>().get(
    "/api/market/snapshot",
    {
      schema: {
        tags: ["Market"],
        querystring: z
          .object({
            symbol: z
              .string()
              .regex(/^[A-Z0-9]{3,30}$/)
              .default("BTCUSDT"),
            interval: z.enum(["1m", "5m", "15m", "1h"]).default("15m")
          })
          .strict()
      }
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const topic: StreamTopic = { kind: "market", ...request.query };
      const key = `${topic.symbol}:${topic.interval}`;
      try {
        let work = pending.get(key);
        if (!work) {
          if (pending.size >= 4) return reply.code(503).send({ error: "snapshot_capacity" });
          work = (async () => {
            const recent = loadHistory
              ? await loadHistory(topic.symbol, topic.interval as ChartInterval)
              : undefined;
            const history = recent
              ? { rows: [] }
              : await pool.query(
                  `SELECT (EXTRACT(EPOCH FROM open_time)*1000)::bigint::text AS "openTimeMs",
            (EXTRACT(EPOCH FROM close_time)*1000)::bigint::text AS "closeTimeMs",
            open::text,high::text,low::text,close::text,volume::text,closed
            FROM klines WHERE symbol=$1 AND interval=$2 ORDER BY open_time DESC LIMIT 200`,
                  [topic.symbol, topic.interval]
                );
            let snapshot: Awaited<ReturnType<typeof bootstrapMarket>>;
            try {
              snapshot = await bootstrapMarket(source, topic, () => loadDepth(topic.symbol));
            } catch (error) {
              if (!recent) throw error;
              return fallbackSnapshot(topic, recent);
            }
            const candles = new Map(
              history.rows.map((row) => [
                Number(row.openTimeMs),
                {
                  ...row,
                  symbol: topic.symbol,
                  interval: topic.interval,
                  openTimeMs: Number(row.openTimeMs),
                  closeTimeMs: Number(row.closeTimeMs)
                }
              ])
            );
            if (recent) for (const candle of recent) candles.set(candle.openTimeMs, candle);
            const trades = [];
            for (const event of snapshot.events) {
              if (
                event.kind === "kline" &&
                (!recent || event.candle.openTimeMs >= recent[0]!.openTimeMs)
              )
                candles.set(event.candle.openTimeMs, event.candle);
              if (event.kind === "trade") trades.push(event.trade);
            }
            return {
              checkedAt: Date.now(),
              symbol: topic.symbol,
              interval: topic.interval,
              cursor: snapshot.cursor,
              book: snapshot.book,
              trades: trades.slice(-200),
              candles: [...candles.values()].sort((a, b) => a.openTimeMs - b.openTimeMs).slice(-200)
            };
          })().finally(() => {
            pending.delete(key);
          });
          pending.set(key, work);
        }
        return await work;
      } catch {
        return reply.code(503).send({ error: "market_snapshot_unavailable" });
      }
    }
  );
}
