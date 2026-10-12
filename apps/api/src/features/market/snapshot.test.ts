import Fastify from "fastify";
import { validatorCompiler, serializerCompiler } from "fastify-type-provider-zod";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { marketEventJsonCodec } from "@meridian/proto";
import { bootstrapMarket, registerMarketSnapshot, type BootstrapSource } from "./snapshot.js";
import { encodeCursor, type StreamTopic } from "../streams/stream-source.js";

const topic: StreamTopic = { kind: "market", symbol: "BTCUSDT", interval: "15m" };
const start = encodeCursor(topic, ["1-0", "2-0", "3-0"]);
const end = encodeCursor(topic, ["4-0", "2-0", "5-0"]);
const depth = {
  lastUpdateId: 100,
  bids: [["90", "2"]] as [string, string][],
  asks: [["110", "3"]] as [string, string][]
};
const delta = (firstUpdateId = 101, finalUpdateId = 102) =>
  marketEventJsonCodec.decode(
    Buffer.from(
      JSON.stringify({
        kind: "depth",
        symbol: "BTCUSDT",
        eventId: "d",
        occurredAtMs: Date.now(),
        depth: {
          firstUpdateId,
          finalUpdateId,
          bids: [
            { price: "90", quantity: "0" },
            { price: "100.00000001", quantity: "1" }
          ],
          asks: []
        }
      })
    )
  );
function source(events = [delta()]): BootstrapSource {
  return {
    captureMarket: vi.fn(async () => ({ cursor: start, events: [] })),
    open: vi.fn(async () => start),
    read: vi.fn(async () => ({ cursor: end, events })),
    close: vi.fn(async () => {})
  };
}
describe("market bootstrap", () => {
  it("prefers recent same-market public history over unrelated old stored candles", async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const query = vi.fn(async () => ({ rows: [] }));
    const recent = vi.fn(async () => [
      {
        symbol: "BTCUSDT",
        interval: "15m",
        openTimeMs: 900000,
        closeTimeMs: 1799999,
        open: "100",
        high: "102",
        low: "99",
        close: "101",
        volume: "1",
        closed: true
      }
    ]);
    registerMarketSnapshot(app, { query } as unknown as Pool, source(), async () => depth, recent);
    try {
      const response = await app.inject("/api/market/snapshot");
      expect(response.statusCode).toBe(200);
      expect(response.json().candles).toMatchObject([{ openTimeMs: 900000, close: "101" }]);
      expect(query).not.toHaveBeenCalled();
      expect(recent).toHaveBeenCalledWith("BTCUSDT", "15m");
    } finally {
      await app.close();
    }
  });
  it("captures before REST fetch, bridges IDs and preserves deletes/precision with a replay cursor", async () => {
    const feed = source();
    const result = await bootstrapMarket(feed, topic, async () => {
      expect(feed.captureMarket).toHaveBeenCalledOnce();
      return depth;
    });
    expect(result.cursor).toBe(end);
    expect(feed.read).toHaveBeenCalledWith(topic, start);
    expect(result.book.lastUpdateId).toBe(102);
    expect(JSON.parse(JSON.stringify(result.book)).bids).toEqual([
      { price: "100.00000001", quantity: "1" }
    ]);
    expect(result.book.complete).toBe(false);
  });
  it("fails closed on a missing bridge", async () => {
    await expect(
      bootstrapMarket(source([delta(103, 104)]), topic, async () => depth)
    ).rejects.toThrow("book_gap");
  });
  it("skips pre-snapshot updates without claiming synchronization", async () => {
    const feed = source();
    vi.mocked(feed.read).mockResolvedValueOnce({ cursor: start, events: [delta(98, 100)] });
    expect((await bootstrapMarket(feed, topic, async () => depth)).book.lastUpdateId).toBe(102);
    expect(feed.read).toHaveBeenCalledTimes(2);
  });
  it("rejects malformed exchange IDs and oversized book levels", async () => {
    await expect(
      bootstrapMarket(source(), topic, async () => ({ ...depth, lastUpdateId: -1 }))
    ).rejects.toThrow();
    await expect(
      bootstrapMarket(source(), topic, async () => ({
        ...depth,
        bids: Array(101).fill(["90", "1"])
      }))
    ).rejects.toThrow();
  });
  it("validates route queries and returns 503 rather than a fake book on stale feed", async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const feed = source();
    vi.mocked(feed.captureMarket).mockRejectedValue(new Error("market_feed_stale"));
    const query = vi.fn(async () => ({ rows: [] }));
    registerMarketSnapshot(app, { query } as unknown as Pool, feed, async () => depth);
    try {
      expect((await app.inject("/api/market/snapshot?symbol=bad!")).statusCode).toBe(400);
      const result = await app.inject("/api/market/snapshot");
      expect(result.statusCode).toBe(503);
      expect(result.json()).toEqual({ error: "market_snapshot_unavailable" });
      expect(result.headers["cache-control"]).toBe("no-store");
    } finally {
      await app.close();
    }
  });
  it("falls back to a REST-only snapshot when public history exists but the stream is absent", async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const feed = source();
    vi.mocked(feed.captureMarket).mockRejectedValue(new Error("stream_unavailable"));
    const query = vi.fn(async () => ({ rows: [] }));
    const recent = vi.fn(async () => [
      {
        symbol: "ETHUSDT",
        interval: "15m",
        openTimeMs: 900000,
        closeTimeMs: 1799999,
        open: "3000",
        high: "3020",
        low: "2990",
        close: "3010",
        volume: "12.5",
        closed: true
      }
    ]);
    registerMarketSnapshot(app, { query } as unknown as Pool, feed, async () => depth, recent);
    try {
      const result = await app.inject("/api/market/snapshot?symbol=ETHUSDT&interval=15m");
      expect(result.statusCode).toBe(200);
      expect(result.json()).toMatchObject({
        symbol: "ETHUSDT",
        interval: "15m",
        cursor: "",
        trades: [],
        candles: [{ symbol: "ETHUSDT", close: "3010" }],
        book: { symbol: "ETHUSDT", lastUpdateId: 100 }
      });
      expect(query).not.toHaveBeenCalled();
      expect(recent).toHaveBeenCalledWith("ETHUSDT", "15m");
    } finally {
      await app.close();
    }
  });
  it("returns stored candles, synchronized book and a cursor without placing orders", async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const query = vi.fn(async () => ({
      rows: [
        {
          openTimeMs: "1",
          closeTimeMs: "2",
          open: "100.01",
          high: "101",
          low: "99",
          close: "100",
          volume: "1",
          closed: true
        }
      ]
    }));
    registerMarketSnapshot(app, { query } as unknown as Pool, source(), async () => depth);
    try {
      const result = await app.inject("/api/market/snapshot");
      expect(result.statusCode).toBe(200);
      expect(result.json()).toMatchObject({
        cursor: end,
        trades: [],
        candles: [{ openTimeMs: 1, open: "100.01" }],
        book: { lastUpdateId: 102 }
      });
      expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE symbol=$1"), [
        "BTCUSDT",
        "15m"
      ]);
    } finally {
      await app.close();
    }
  });
});
