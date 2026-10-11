import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { describe, expect, it, vi } from "vitest";
import { registerApiAuth } from "../../app/auth.js";
import { registerStreams } from "./streams.js";
import {
  coalesceDepth,
  decodeCursor,
  encodeCursor,
  type StreamSource,
  type StreamTopic
} from "./stream-source.js";
import { marketEventJsonCodec } from "@meridian/proto";

const topic: StreamTopic = { kind: "market", symbol: "BTCUSDT", interval: "15m" };
const cursor = encodeCursor(topic, ["1-0", "2-0", "3-0"]);
async function fixture(
  source: StreamSource,
  auth = {},
  options: Parameters<typeof registerStreams>[2] = {}
) {
  const server = Fastify();
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  registerApiAuth(server, auth);
  registerStreams(server, source, { intervalMs: 10, heartbeatMs: 20, ...options });
  await server.listen({ host: "127.0.0.1", port: 0 });
  return server;
}
describe("SSE transport", () => {
  it("pushes health and visible heartbeats without changing resumable event cursors", async () => {
    const source = {
      open: vi.fn(async () => cursor),
      read: vi.fn(async () => ({ cursor, events: [] })),
      close: vi.fn(async () => {})
    };
    const health = vi.fn(async () => ({
      checkedAt: Date.now(),
      redis: "available" as const,
      database: "unavailable" as const,
      streams: []
    }));
    const server = await fixture(source, {}, { health, healthIntervalMs: 10 });
    const controller = new AbortController();
    try {
      const response = await fetch(`${server.listeningOrigin}/api/stream/account`, {
        signal: controller.signal
      });
      const reader = response.body!.getReader();
      let body = "";
      while (!body.includes("event: heartbeat") || !body.includes("event: health")) {
        const chunk = await reader.read();
        body += new TextDecoder().decode(chunk.value);
      }
      expect(body).toContain('"database":"unavailable"');
      expect(body.match(/^id:/gm)).toHaveLength(1);
      controller.abort();
      await reader.cancel().catch(() => {});
    } finally {
      controller.abort();
      await server.close();
    }
    const calls = health.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(health).toHaveBeenCalledTimes(calls);
  });
  it("accepts the bootstrap cursor from EventSource query and prefers a reconnect header", async () => {
    const source = {
      open: vi.fn(async () => cursor),
      read: vi.fn(async () => ({ cursor, events: [] })),
      close: vi.fn(async () => {})
    };
    const server = await fixture(source);
    try {
      for (const headers of [undefined, { "last-event-id": "reconnect" }]) {
        const controller = new AbortController();
        const response = await fetch(
          `${server.listeningOrigin}/api/stream/market?cursor=${cursor}`,
          {
            ...(headers ? { headers } : {}),
            signal: controller.signal
          }
        );
        expect(response.status).toBe(200);
        expect(source.open).toHaveBeenLastCalledWith(topic, headers?.["last-event-id"] ?? cursor);
        controller.abort();
        await response.body?.cancel().catch(() => {});
      }
    } finally {
      await server.close();
    }
  });
  it("closes oversized responses rather than retaining an unbounded queue", async () => {
    const source = {
      open: vi.fn(async () => cursor),
      read: vi.fn(async () => ({ cursor, events: ["x".repeat(2000)] })),
      close: vi.fn(async () => {})
    };
    const server = await fixture(source, {}, { maxBufferedBytes: 1024 });
    try {
      const response = await fetch(`${server.listeningOrigin}/api/stream/market`);
      const body = await response.text();
      expect(body).toContain("event: ready");
      expect(body).not.toContain("x".repeat(1000));
      expect(source.read).toHaveBeenCalledOnce();
    } finally {
      await server.close();
    }
  });
  it("closes a failed source with a resync event and leaves no repeating reader", async () => {
    const source = {
      open: vi.fn(async () => cursor),
      read: vi.fn(async () => {
        throw new Error("Redis unavailable");
      }),
      close: vi.fn(async () => {})
    };
    const server = await fixture(source);
    try {
      const response = await fetch(`${server.listeningOrigin}/api/stream/account`);
      expect(await response.text()).toContain("event: resync");
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(source.read).toHaveBeenCalledOnce();
    } finally {
      await server.close();
    }
  });
  it("enforces concurrent connection capacity", async () => {
    const source = {
      open: vi.fn(async () => cursor),
      read: vi.fn(async () => ({ cursor, events: [] })),
      close: vi.fn(async () => {})
    };
    const server = await fixture(source, {}, { maxConnections: 1 });
    const controller = new AbortController();
    try {
      const first = await fetch(`${server.listeningOrigin}/api/stream/market`, {
        signal: controller.signal
      });
      const second = await fetch(`${server.listeningOrigin}/api/stream/market`);
      expect(second.status).toBe(503);
      expect((await second.json()).error).toBe("stream_capacity");
      controller.abort();
      await first.body?.cancel().catch(() => {});
    } finally {
      controller.abort();
      await server.close();
    }
  });
  it("validates cursor version, topic, arity and ID grammar", () => {
    expect(decodeCursor(topic, cursor).ids).toEqual(["1-0", "2-0", "3-0"]);
    for (const invalid of [
      "1-0",
      "v1.bad",
      encodeCursor({ ...topic, symbol: "ETHUSDT" }, ["1-0", "2-0", "3-0"]),
      encodeCursor(topic, ["1-0"]),
      encodeCursor(topic, ["1-0", "evil\n", "3-0"])
    ])
      expect(() => decodeCursor(topic, invalid)).toThrow();
  });
  it("coalesces contiguous book deltas by price without dropping deletions", () => {
    const event = (u: number, bids: string[][]) =>
      marketEventJsonCodec.decode(
        Buffer.from(
          JSON.stringify({
            kind: "depth",
            symbol: "BTCUSDT",
            eventId: String(u),
            occurredAtMs: 1,
            depth: {
              firstUpdateId: u,
              finalUpdateId: u,
              bids: bids.map(([price, quantity]) => ({ price, quantity })),
              asks: []
            }
          })
        )
      );
    const result = coalesceDepth([
      event(1, [
        ["100", "2"],
        ["99", "1"]
      ]),
      event(2, [
        ["100", "0"],
        ["98", "3"]
      ])
    ]);
    expect(result).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(result))[0].depth.bids).toEqual([
      { price: "100", quantity: "0" },
      { price: "99", quantity: "1" },
      { price: "98", quantity: "3" }
    ]);
    expect(() => coalesceDepth([event(1, []), event(3, [])])).toThrow("gap");
  });
  it("sends IDs/heartbeats, resumes and cleans up disconnected sockets", async () => {
    const source = {
      open: vi.fn(async () => cursor),
      read: vi.fn(async () => ({ cursor, events: [{ kind: "trade", price: "0.00000001" }] })),
      close: vi.fn(async () => {})
    };
    const server = await fixture(source);
    const controller = new AbortController();
    try {
      const response = await fetch(`${server.listeningOrigin}/api/stream/market`, {
        headers: { "Last-Event-ID": cursor },
        signal: controller.signal
      });
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      const reader = response.body!.getReader();
      let text = "";
      while (!text.includes("heartbeat")) {
        const part = await reader.read();
        text += new TextDecoder().decode(part.value);
      }
      expect(text).toContain(`id: ${cursor}`);
      expect(text).toContain("event: market");
      expect(source.open).toHaveBeenCalledWith(topic, cursor);
      controller.abort();
      await reader.cancel().catch(() => {});
    } finally {
      controller.abort();
      await server.close();
    }
    expect(source.close).toHaveBeenCalledOnce();
  });
  it("requires authentication and signals expired-cursor resync without opening SSE", async () => {
    const source = {
      open: vi.fn(async () => {
        throw new Error("cursor_expired_resync_required");
      }),
      read: vi.fn(),
      close: vi.fn(async () => {})
    };
    const token = "v".repeat(40);
    const server = await fixture(source, { viewerToken: token });
    try {
      expect((await server.inject({ url: "/api/stream/market" })).statusCode).toBe(401);
      const response = await server.inject({
        url: "/api/stream/market",
        headers: { authorization: `Bearer ${token}` }
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toBe("resync_required");
      expect(source.read).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });
});
