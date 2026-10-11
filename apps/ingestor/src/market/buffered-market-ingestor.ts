import { marketEventProtobufCodec } from "@meridian/proto";
import { normalizeMarketStreamEvent, type NormalizedMarketEvent } from "./market-events.js";
import { writeMarketEventBatch, type MarketBatchWriteResult } from "./market-batch-writer.js";
import { publishNormalizedMarketEvent } from "./market-publisher.js";
import type { MarketIngestor, MarketIngestorFactoryDeps } from "./market-ingestor-factory.js";

export interface IngestBufferOptions {
  readonly capacity: number;
  readonly batchSize: number;
  readonly flushMs: number;
}

interface PendingWrite {
  event: NormalizedMarketEvent;
  resolve: (result: MarketBatchWriteResult) => void;
  reject: (error: unknown) => void;
}

export function createBufferedMarketIngestor(
  deps: MarketIngestorFactoryDeps,
  options: IngestBufferOptions
): MarketIngestor {
  for (const value of [options.capacity, options.batchSize, options.flushMs]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error("invalid_ingest_buffer");
  }
  if (
    options.batchSize > options.capacity ||
    options.batchSize > 1000 ||
    options.capacity > 10000 ||
    options.flushMs > 1000
  )
    throw new Error("invalid_ingest_buffer");
  if (deps.sessionRecorder) throw new Error("buffered_ingest_recorder_not_supported");
  const codec = deps.codec ?? marketEventProtobufCodec;
  let writes: PendingWrite[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushing = false;
  let closed = false;
  let failed = false;
  let failure: unknown;
  const active = new Set<Promise<unknown>>();
  const empty = { tradesWritten: 0, klinesWritten: 0, duplicatesSkipped: 0 };
  const fail = (error: unknown) => {
    failed = true;
    failure = error;
    clearTimeout(timer);
    timer = undefined;
    for (const write of writes.splice(0)) write.reject(error);
  };
  const key = (event: NormalizedMarketEvent) =>
    event.kind === "trade"
      ? `${event.kind}:${event.symbol}:${event.eventId}:${event.trade.eventTimeMs}`
      : event.kind === "kline"
        ? `${event.kind}:${event.symbol}:${event.candle.interval}:${event.candle.openTimeMs}`
        : `${event.kind}:${event.symbol}:${event.eventId}`;
  const schedule = () => {
    if (flushing || failed || !writes.length) return;
    if (closed)
      queueMicrotask(() => {
        void flush();
      });
    else if (writes.length >= options.batchSize) void flush();
    else
      timer ??= setTimeout(() => {
        timer = undefined;
        void flush();
      }, options.flushMs);
  };
  async function flush() {
    if (flushing || failed || !writes.length) return;
    clearTimeout(timer);
    timer = undefined;
    flushing = true;
    const batch = writes.splice(0, options.batchSize);
    // SQL upserts cannot update a conflict key twice in one statement. Keep the latest
    // candle observation, never replacing a closed candle with an in-flight update.
    const selected = new Map<string, PendingWrite>();
    for (const write of batch) {
      const previous = selected.get(key(write.event));
      if (
        previous?.event.kind === "kline" &&
        write.event.kind === "kline" &&
        ((previous.event.candle.closed && !write.event.candle.closed) ||
          (previous.event.candle.closed === write.event.candle.closed &&
            previous.event.occurredAtMs > write.event.occurredAtMs))
      )
        continue;
      selected.set(key(write.event), write);
    }
    try {
      await writeMarketEventBatch(
        [...selected.values()].map((write) => write.event),
        { ...deps, parallelWrites: true }
      );
      for (const write of batch) {
        const chosen = selected.get(key(write.event)) === write;
        write.resolve({
          tradesWritten: chosen && write.event.kind === "trade" ? 1 : 0,
          klinesWritten: chosen && write.event.kind === "kline" ? 1 : 0,
          duplicatesSkipped: chosen ? 0 : 1
        });
      }
    } catch (error) {
      fail(error);
      for (const write of batch) write.reject(error);
    } finally {
      flushing = false;
      schedule();
    }
  }
  return {
    ingest(input, receivedAtMs = performance.now()) {
      if (closed) return Promise.reject(new Error("ingestor_draining"));
      if (failed) return Promise.reject(failure);
      if (active.size >= options.capacity) return Promise.reject(new Error("ingestor_capacity"));
      const work = (async () => {
        const event = normalizeMarketStreamEvent(input);
        const publishResult = await publishNormalizedMarketEvent(event, {
          encode: codec.encode,
          xadd: deps.xadd
        });
        deps.onPublished?.(event.kind, performance.now() - receivedAtMs);
        if (failed) throw failure;
        const batchWriteResult =
          event.kind === "depth"
            ? empty
            : await new Promise<MarketBatchWriteResult>((resolve, reject) => {
                writes.push({ event, resolve, reject });
                schedule();
              });
        return { event, publishResult, batchWriteResult };
      })();
      active.add(work);
      void work.then(
        () => active.delete(work),
        (error) => {
          active.delete(work);
          fail(error);
        }
      );
      return work;
    },
    async drain() {
      closed = true;
      schedule();
      await Promise.allSettled([...active]);
      if (failed) throw failure;
    }
  };
}
