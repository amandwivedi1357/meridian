import { open, stat } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

const stream = "market.trade.BTCUSDT";
const durationMs = 86_400_000;

export interface DashboardTrade {
  id: string;
  time: number;
  price: string;
  quantity: string;
  side: "buy" | "sell";
}

interface DashboardRedis {
  xRevRange: (
    key: string,
    start: string,
    end: string,
    options: { COUNT: number }
  ) => Promise<{ message: Record<string, string> }[] | null>;
  xLen: (key: string) => Promise<number>;
  info: (section: string) => Promise<string>;
}

export function parseTrade(payload: string): DashboardTrade | null {
  try {
    const event = JSON.parse(payload);
    const trade = event.trade;
    if (
      event.kind !== "trade" ||
      event.symbol !== "BTCUSDT" ||
      typeof trade?.tradeId !== "string" ||
      typeof trade.price !== "string" ||
      typeof trade.quantity !== "string" ||
      typeof trade.eventTimeMs !== "number" ||
      !Number.isFinite(trade.eventTimeMs) ||
      !Number.isFinite(Number(trade.price)) ||
      Number(trade.price) <= 0 ||
      !Number.isFinite(Number(trade.quantity)) ||
      Number(trade.quantity) < 0 ||
      typeof trade.isBuyerMaker !== "boolean"
    )
      return null;
    return {
      id: trade.tradeId,
      time: trade.eventTimeMs,
      price: trade.price,
      quantity: trade.quantity,
      side: trade.isBuyerMaker ? "sell" : "buy"
    };
  } catch {
    return null;
  }
}

export function feedStatus(
  lastTradeTime: number | null,
  now: number
): "live" | "stale" | "waiting" {
  return lastTradeTime === null ? "waiting" : now - lastTradeTime > 15_000 ? "stale" : "live";
}

async function fileInfo(path: string) {
  try {
    const info = await stat(path);
    return { bytes: info.size, updatedAt: info.mtimeMs, startedAt: info.birthtimeMs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function tail(path: string): Promise<string> {
  const info = await fileInfo(path);
  if (!info || info.bytes === 0) return "";
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(Math.min(info.bytes, 8192));
    await handle.read(buffer, 0, buffer.length, info.bytes - buffer.length);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

export function registerDashboard(
  server: FastifyInstance,
  redis: DashboardRedis,
  pool: Pool,
  workspace: string
) {
  let databaseCache: { checkedAt: number; count: number } | null = null;
  let pendingDatabase: Promise<{ checkedAt: number; count: number }> | null = null;
  async function databaseCount() {
    if (databaseCache && Date.now() - databaseCache.checkedAt < 15_000) return databaseCache;
    pendingDatabase ??= pool
      .query<{ count: string }>("SELECT COUNT(*)::text AS count FROM trades WHERE symbol = $1", [
        "BTCUSDT"
      ])
      .then((result) => {
        databaseCache = { checkedAt: Date.now(), count: Number(result.rows[0]?.count ?? 0) };
        return databaseCache;
      })
      .finally(() => {
        pendingDatabase = null;
      });
    return pendingDatabase;
  }

  server.get("/api/dashboard", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    const now = Date.now();
    const recordingPath = `${workspace}/sessions/soak/phase-1-5-events.ndjson`;
    const outputPath = `${workspace}/logs/soak/phase-1-5-live-ingest.out.log`;
    const errorPath = `${workspace}/logs/soak/phase-1-5-live-ingest.err.log`;
    const [redisResult, dbResult, recording, outputInfo, output, errors] = await Promise.all([
      Promise.all([
        redis.xRevRange(stream, "+", "-", { COUNT: 500 }),
        redis.xLen(stream),
        redis.info("memory")
      ])
        .then(([entries, count, memory]) => ({
          trades: (entries ?? [])
            .map((entry) => parseTrade(entry.message.payload ?? ""))
            .filter((trade): trade is DashboardTrade => trade !== null)
            .reverse(),
          count,
          memoryBytes: Number(memory.match(/^used_memory:(\d+)/m)?.[1] ?? 0)
        }))
        .then(
          (value) => ({ ok: true as const, value }),
          () => ({ ok: false as const })
        ),
      databaseCount().then(
        (value) => ({ ok: true as const, value }),
        () => ({ ok: false as const })
      ),
      fileInfo(recordingPath),
      fileInfo(outputPath),
      tail(outputPath),
      tail(errorPath)
    ]);
    const trades = redisResult.ok ? redisResult.value.trades : [];
    const latest = trades.at(-1);
    const freshness = feedStatus(latest?.time ?? null, now);
    const startedAt = outputInfo?.startedAt ?? null;
    const elapsedMs = startedAt === null ? 0 : Math.max(0, now - startedAt);
    // The CLI logs a result on exit; elapsed time alone is not proof of completion.
    const completed = output.includes('"kind":"live-ingest-smoke-completed"');
    const status = errors.trim()
      ? "attention"
      : completed
        ? "finished"
        : !redisResult.ok ||
            !dbResult.ok ||
            freshness !== "live" ||
            !recording ||
            now - recording.updatedAt > 15_000
          ? "attention"
          : "running";
    return {
      checkedAt: now,
      symbol: "BTCUSDT",
      source: "Binance Spot / public production feed",
      feed: freshness,
      trades,
      redis: {
        available: redisResult.ok,
        count: redisResult.ok ? redisResult.value.count : null,
        memoryBytes: redisResult.ok ? redisResult.value.memoryBytes : null
      },
      database: {
        available: dbResult.ok,
        count: dbResult.ok ? dbResult.value.count : null,
        checkedAt: dbResult.ok ? dbResult.value.checkedAt : null
      },
      recording: recording ? { ...recording, path: "sessions/soak/phase-1-5-events.ndjson" } : null,
      soak: {
        status,
        startedAt,
        elapsedMs,
        durationMs,
        progress: Math.min(1, elapsedMs / durationMs),
        completed,
        hasErrors: Boolean(errors.trim())
      }
    };
  });
}
