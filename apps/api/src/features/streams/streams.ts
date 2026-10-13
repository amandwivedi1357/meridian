import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { currentPrincipal } from "../../app/auth.js";
import type { StreamSource, StreamTopic } from "./stream-source.js";
import type { HealthReader } from "../health/system-health.js";
import type { MarketDemandLease } from "../market/demand.js";

export function registerStreams(
  server: FastifyInstance,
  source: StreamSource,
  options: {
    intervalMs?: number;
    heartbeatMs?: number;
    maxConnections?: number;
    maxBufferedBytes?: number;
    health?: HealthReader;
    healthIntervalMs?: number;
    marketDemand?: (symbol: string) => Promise<MarketDemandLease>;
  } = {}
) {
  const app = server.withTypeProvider<ZodTypeProvider>();
  const clients = new Set<() => void>();
  let opening = 0;
  server.addHook("preClose", async () => {
    for (const close of clients) close();
  });
  server.addHook("onClose", async () => {
    await source.close();
  });
  for (const kind of ["market", "account"] as const) {
    app.get(
      `/api/stream/${kind}`,
      {
        schema: {
          tags: ["Streams"],
          description:
            "SSE batches; resume with Last-Event-ID. A 409 requires a REST snapshot/resync.",
          querystring: z
            .object({
              symbol: z
                .string()
                .regex(/^[A-Z0-9]{2,30}$/)
                .default("BTCUSDT"),
              interval: z.enum(["1m", "5m", "15m", "1h"]).default("15m"),
              cursor: z.string().max(512).optional()
            })
            .strict(),
          headers: z.object({ "last-event-id": z.string().max(512).optional() }).passthrough()
        }
      },
      async (request, reply) => {
        if (clients.size + opening >= (options.maxConnections ?? 600))
          return reply.code(503).send({ error: "stream_capacity" });
        const topic: StreamTopic = {
          kind,
          symbol: request.query.symbol,
          interval: request.query.interval
        };
        let cursor: string;
        let demand: MarketDemandLease | undefined;
        opening++;
        try {
          if (kind === "market") demand = await options.marketDemand?.(topic.symbol);
          cursor = await source.open(
            topic,
            request.headers["last-event-id"] ?? request.query.cursor
          );
        } catch (error) {
          await demand?.release().catch(() => {});
          const reason = error instanceof Error ? error.message : "stream_unavailable";
          return reply
            .code(reason.includes("cursor") ? 409 : 503)
            .send({ error: reason.includes("cursor") ? "resync_required" : "stream_unavailable" });
        } finally {
          opening--;
        }
        if (request.raw.destroyed) {
          await demand?.release().catch(() => {});
          return;
        }
        reply.hijack();
        const raw = reply.raw;
        raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-store",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no"
        });
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        let healthTimer: ReturnType<typeof setInterval> | undefined;
        const close = () => {
          if (stopped) return;
          stopped = true;
          clearTimeout(timer);
          clearInterval(heartbeat);
          clearInterval(healthTimer);
          void demand?.release().catch(() => {});
          clients.delete(close);
          raw.off("close", close);
          raw.off("error", close);
          raw.end();
          if (raw.writableLength) raw.destroy();
        };
        clients.add(close);
        raw.once("close", close);
        raw.once("error", close);
        function write(value: string) {
          if (stopped) return false;
          if (
            raw.writableLength + Buffer.byteLength(value) >
            (options.maxBufferedBytes ?? 256 * 1024)
          ) {
            close();
            return false;
          }
          raw.write(value);
          return true;
        }
        write(`retry: 2000\nid: ${cursor}\nevent: ready\ndata: {"kind":"${kind}"}\n\n`);
        const expiresAt = currentPrincipal(request)?.expiresAtMs;
        heartbeat = setInterval(() => {
          if (expiresAt && Date.now() >= expiresAt) close();
          else {
            void demand?.refresh().catch(() => close());
            write(`event: heartbeat\ndata: {"checkedAt":${Date.now()}}\n\n`);
          }
        }, options.heartbeatMs ?? 15000);
        if (kind === "account" && options.health) {
          let sampling = false;
          const sample = async () => {
            if (stopped || sampling || (expiresAt && Date.now() >= expiresAt)) return;
            sampling = true;
            try {
              const data = await options.health!();
              if (!expiresAt || Date.now() < expiresAt)
                write(`event: health\ndata: ${JSON.stringify(data)}\n\n`);
            } catch {
              /* Health must not disrupt account delivery. */
            } finally {
              sampling = false;
            }
          };
          void sample();
          healthTimer = setInterval(() => {
            void sample();
          }, options.healthIntervalMs ?? 5000);
        }
        async function tick() {
          if (stopped) return;
          if (expiresAt && Date.now() >= expiresAt) {
            close();
            return;
          }
          if (raw.writableNeedDrain) {
            timer = setTimeout(() => {
              void tick();
            }, options.intervalMs ?? 250);
            return;
          }
          try {
            const batch = await source.read(topic, cursor);
            if (
              !stopped &&
              batch.events.length &&
              write(
                `id: ${batch.cursor}\nevent: ${kind}\ndata: ${JSON.stringify({ events: batch.events })}\n\n`
              )
            )
              cursor = batch.cursor;
          } catch {
            write('event: resync\ndata: {"reason":"stream_unavailable_or_gap"}\n\n');
            close();
          }
          if (!stopped)
            timer = setTimeout(() => {
              void tick();
            }, options.intervalMs ?? 250);
        }
        void tick();
      }
    );
  }
}
