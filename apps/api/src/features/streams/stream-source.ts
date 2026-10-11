import { Redis } from "ioredis";
import type { Pool } from "pg";
import { decodeMarketEvent, marketEventJsonCodec, type MarketEventMessage } from "@meridian/proto";
import { createHash } from "node:crypto";
import { readTradingState } from "../trading-state/trading-state.js";
import type { PortfolioReader } from "../account/portfolio.js";

export interface StreamTopic {
  kind: "market" | "account";
  symbol: string;
  interval: string;
}
export interface StreamBatch {
  cursor: string;
  events: readonly unknown[];
}
export interface StreamSource {
  open(topic: StreamTopic, lastEventId?: string): Promise<string>;
  read(topic: StreamTopic, cursor: string): Promise<StreamBatch>;
  close(): Promise<void>;
}
type Cursor = { topic: string; ids: string[] };
const idPattern = /^\d{1,20}-\d{1,20}$/;
const topicId = (topic: StreamTopic) =>
  topic.kind === "account" ? "account" : `${topic.symbol}:${topic.interval}`;
const keys = (topic: StreamTopic) =>
  topic.kind === "account"
    ? ["meridian:api:account-events"]
    : [
        `market.trade.${topic.symbol}`,
        `market.kline.${topic.symbol}.${topic.interval}`,
        `market.book.${topic.symbol}`
      ];
export function encodeCursor(topic: StreamTopic, ids: string[]) {
  return `v1.${Buffer.from(JSON.stringify({ topic: topicId(topic), ids })).toString("base64url")}`;
}
export function decodeCursor(topic: StreamTopic, value: string): Cursor {
  if (value.length > 512 || !/^v1\.[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid_cursor");
  const c = JSON.parse(Buffer.from(value.slice(3), "base64url").toString()) as Cursor;
  if (
    !c ||
    c.topic !== topicId(topic) ||
    !Array.isArray(c.ids) ||
    c.ids.length !== keys(topic).length ||
    c.ids.some((id) => typeof id !== "string" || !idPattern.test(id))
  )
    throw new Error("invalid_cursor");
  return c;
}
function entries(reply: unknown): { id: string; payload: Buffer }[] {
  if (!Array.isArray(reply)) throw new Error("stream_unavailable");
  return reply.map((entry: unknown) => {
    if (!Array.isArray(entry) || entry.length !== 2 || !Array.isArray(entry[1]))
      throw new Error("invalid_stream_entry");
    const fields = entry[1] as Buffer[];
    const index = fields.findIndex((field, i) => i % 2 === 0 && String(field) === "payload");
    const id = String(entry[0]);
    if (
      !idPattern.test(id) ||
      index < 0 ||
      !Buffer.isBuffer(fields[index + 1]) ||
      fields[index + 1]!.length > 128 * 1024
    )
      throw new Error("invalid_stream_entry");
    return { id, payload: fields[index + 1]! };
  });
}
export function decodePayload(payload: Buffer): MarketEventMessage {
  return payload[0] === 123 ? marketEventJsonCodec.decode(payload) : decodeMarketEvent(payload);
}
export function coalesceDepth(events: readonly MarketEventMessage[]): MarketEventMessage[] {
  const result: MarketEventMessage[] = [];
  let depth: Extract<MarketEventMessage, { kind: "depth" }> | undefined;
  for (const event of events) {
    if (event.kind !== "depth") {
      result.push(event);
      continue;
    }
    if (
      !Number.isSafeInteger(event.depth.firstUpdateId) ||
      !Number.isSafeInteger(event.depth.finalUpdateId) ||
      event.depth.firstUpdateId < 0 ||
      event.depth.finalUpdateId < event.depth.firstUpdateId
    )
      throw new Error("invalid_book_update");
    if (!depth) {
      depth = event;
      continue;
    }
    if (
      event.depth.firstUpdateId > depth.depth.finalUpdateId + 1 ||
      event.depth.finalUpdateId <= depth.depth.finalUpdateId
    )
      throw new Error("book_gap_resync_required");
    type Levels = Extract<MarketEventMessage, { kind: "depth" }>["depth"]["bids"];
    const merge = (a: Levels, b: Levels) => [
      ...new Map([...a, ...b].map((level) => [level.price.toFixed(), level])).values()
    ];
    depth = {
      ...event,
      depth: {
        ...event.depth,
        firstUpdateId: depth.depth.firstUpdateId,
        bids: merge(depth.depth.bids, event.depth.bids),
        asks: merge(depth.depth.asks, event.depth.asks)
      }
    };
  }
  if (depth) result.push(depth);
  return result;
}

export function createStreamSource(
  redisUrl: string,
  pool: Pool,
  options: { namespace?: string; marketPrefix?: string; portfolio?: PortfolioReader } = {}
): StreamSource & {
  captureMarket(topic: StreamTopic): Promise<{ cursor: string; events: MarketEventMessage[] }>;
} {
  const namespace = options.namespace ?? "meridian:api";
  const streamKeys = (topic: StreamTopic) =>
    topic.kind === "account"
      ? [`${namespace}:account-events`]
      : keys(topic).map((key) => `${options.marketPrefix ?? ""}${key}`);
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    commandTimeout: 2000
  });
  redis.on("error", () => {});
  let accountInFlight: Promise<void> | undefined;
  let connecting: Promise<void> | undefined;
  let lastAccountSample = 0;
  async function ready() {
    // Concurrent cold-start opens must await the same connection attempt.
    if (!connecting && redis.status === "wait") {
      connecting = redis.connect().finally(() => {
        connecting = undefined;
      });
    }
    if (connecting) await connecting;
    if (redis.status !== "ready") throw new Error("stream_unavailable");
  }
  async function sampleAccount() {
    if (accountInFlight) return accountInFlight;
    if (Date.now() - lastAccountSample < 250) return;
    accountInFlight = (async () => {
      const client = await pool.connect();
      let data;
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const snapshot = await readTradingState(client, 100, true);
        data = JSON.stringify({
          kind: "account-snapshot",
          ...snapshot,
          historyLimit: 100
        });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      if (options.portfolio)
        data = JSON.stringify({ ...JSON.parse(data), portfolio: await options.portfolio() });
      if (Buffer.byteLength(data) > 240 * 1024) throw new Error("account_snapshot_capacity");
      const fingerprint = JSON.parse(data);
      fingerprint.checkedAt = undefined;
      if (fingerprint.portfolio) fingerprint.portfolio.checkedAt = undefined;
      const digest = createHash("sha256").update(JSON.stringify(fingerprint)).digest("hex");
      await redis.eval(
        `if redis.call('GET',KEYS[1]) == ARGV[1] and redis.call('EXISTS',KEYS[2]) == 1 then return 0 end
        local id=redis.call('XADD',KEYS[2],'MAXLEN','=','128','*','payload',ARGV[2])
        redis.call('SET',KEYS[1],ARGV[1]); return id`,
        2,
        `${namespace}:account-digest`,
        `${namespace}:account-events`,
        digest,
        data
      );
      lastAccountSample = Date.now();
    })().finally(() => {
      accountInFlight = undefined;
    });
    return accountInFlight;
  }
  async function range(key: string, start: string, end: string, count = 100) {
    return entries(await redis.callBuffer("XRANGE", key, start, end, "COUNT", count));
  }
  async function validate(topic: StreamTopic, cursor: Cursor) {
    for (const [i, key] of streamKeys(topic).entries()) {
      if (cursor.ids[i] !== "0-0" && !(await range(key, cursor.ids[i]!, cursor.ids[i]!, 1)).length)
        throw new Error("cursor_expired_resync_required");
    }
  }
  return {
    async captureMarket(topic) {
      if (topic.kind !== "market") throw new Error("invalid_topic");
      await ready();
      // Capture histories and their checkpoints atomically, before fetching the exchange snapshot.
      const result = (await redis.callBuffer(
        "EVAL",
        "local r={} for i,k in ipairs(KEYS) do local n=200 if i==3 then n=1 end r[i]=redis.call('XREVRANGE',k,'+','-','COUNT',n) end return r",
        3,
        ...streamKeys(topic)
      )) as unknown[];
      const histories = result.map(entries);
      if (histories.flat().reduce((size, row) => size + row.payload.length, 0) > 256 * 1024)
        throw new Error("snapshot_capacity");
      const events = histories.flatMap((rows, i) =>
        i === 2 ? [] : [...rows].reverse().map((row) => decodePayload(row.payload))
      );
      if (
        events.some(
          (event) =>
            event.symbol !== topic.symbol ||
            (event.kind === "kline" && event.candle.interval !== topic.interval)
        )
      )
        throw new Error("invalid_market_event");
      const latestBook = histories[2]?.[0];
      const book = latestBook ? decodePayload(latestBook.payload) : undefined;
      if (
        !book ||
        book.kind !== "depth" ||
        book.symbol !== topic.symbol ||
        Date.now() - book.occurredAtMs > 15000 ||
        book.occurredAtMs > Date.now() + 5000
      )
        throw new Error("market_feed_stale");
      return {
        cursor: encodeCursor(
          topic,
          histories.map((rows) => rows[0]?.id ?? "0-0")
        ),
        events
      };
    },
    async open(topic, lastEventId) {
      await ready();
      if (topic.kind === "account") await sampleAccount();
      if (lastEventId) {
        const cursor = decodeCursor(topic, lastEventId);
        await validate(topic, cursor);
        return lastEventId;
      }
      const ids = [];
      for (const key of streamKeys(topic)) {
        const latest = entries(await redis.callBuffer("XREVRANGE", key, "+", "-", "COUNT", 1));
        // Account clients receive the latest complete snapshot on their first connection.
        ids.push(topic.kind === "account" ? "0-0" : (latest[0]?.id ?? "0-0"));
      }
      return encodeCursor(topic, ids);
    },
    async read(topic, value) {
      await ready();
      if (topic.kind === "account") await sampleAccount();
      const cursor = decodeCursor(topic, value);
      await validate(topic, cursor);
      const events: unknown[] = [];
      let payloadBytes = 0;
      for (const [i, key] of streamKeys(topic).entries()) {
        const rows =
          topic.kind === "account" && cursor.ids[i] === "0-0"
            ? entries(await redis.callBuffer("XREVRANGE", key, "+", "-", "COUNT", 1))
            : await range(key, `(${cursor.ids[i]}`, "+");
        payloadBytes += rows.reduce((sum, row) => sum + row.payload.length, 0);
        if (payloadBytes > 256 * 1024) throw new Error("stream_batch_resync_required");
        const decoded = rows.map((row) => {
          if (topic.kind === "account") return JSON.parse(row.payload.toString());
          const event =
            row.payload[0] === 123
              ? marketEventJsonCodec.decode(row.payload)
              : decodeMarketEvent(row.payload);
          const expected = i === 0 ? "trade" : i === 1 ? "kline" : "depth";
          if (
            event.symbol !== topic.symbol ||
            event.kind !== expected ||
            (event.kind === "kline" && event.candle.interval !== topic.interval)
          )
            throw new Error("invalid_market_event");
          return event;
        });
        if (topic.kind === "market" && i === 2 && cursor.ids[i] !== "0-0" && decoded.length) {
          const previous = (await range(key, cursor.ids[i]!, cursor.ids[i]!, 1))[0]!;
          const event =
            previous.payload[0] === 123
              ? marketEventJsonCodec.decode(previous.payload)
              : decodeMarketEvent(previous.payload);
          const next = decoded[0] as MarketEventMessage;
          if (
            event.kind !== "depth" ||
            next.kind !== "depth" ||
            next.depth.firstUpdateId > event.depth.finalUpdateId + 1 ||
            next.depth.finalUpdateId <= event.depth.finalUpdateId
          )
            throw new Error("book_gap_resync_required");
        }
        events.push(
          ...(topic.kind === "market" && i === 2
            ? coalesceDepth(decoded as MarketEventMessage[])
            : decoded)
        );
        if (rows.length) cursor.ids[i] = rows.at(-1)!.id;
      }
      return { cursor: encodeCursor(topic, cursor.ids), events };
    },
    async close() {
      redis.disconnect();
      await connecting?.catch(() => {});
      await accountInFlight?.catch(() => {});
    }
  };
}
