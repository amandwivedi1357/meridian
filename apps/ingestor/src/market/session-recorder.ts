import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { NormalizedMarketEvent } from "./market-events.js";

export interface SessionRecorder {
  readonly record: (event: NormalizedMarketEvent) => Promise<void>;
}

export interface SessionRecorderDeps {
  readonly appendFile?: typeof appendFile;
  readonly mkdir?: typeof mkdir;
}

export function createSessionRecorder(
  filePath: string,
  deps: SessionRecorderDeps = {}
): SessionRecorder {
  const writeFile = deps.appendFile ?? appendFile;
  const makeDir = deps.mkdir ?? mkdir;
  let initialized = false;

  return {
    async record(event) {
      if (!initialized) {
        await makeDir(dirname(filePath), { recursive: true });
        initialized = true;
      }

      await writeFile(filePath, `${JSON.stringify(toRecord(event))}\n`, "utf8");
    }
  };
}

function toRecord(event: NormalizedMarketEvent): unknown {
  switch (event.kind) {
    case "trade":
      return {
        kind: event.kind,
        symbol: event.symbol,
        eventId: event.eventId,
        occurredAtMs: event.occurredAtMs,
        trade: {
          ...event.trade,
          price: event.trade.price.toString(),
          quantity: event.trade.quantity.toString()
        }
      };

    case "kline":
      return {
        kind: event.kind,
        symbol: event.symbol,
        eventId: event.eventId,
        occurredAtMs: event.occurredAtMs,
        candle: {
          ...event.candle,
          open: event.candle.open.toString(),
          high: event.candle.high.toString(),
          low: event.candle.low.toString(),
          close: event.candle.close.toString(),
          volume: event.candle.volume.toString()
        }
      };

    case "depth":
      return {
        kind: event.kind,
        symbol: event.symbol,
        eventId: event.eventId,
        occurredAtMs: event.occurredAtMs,
        depth: {
          firstUpdateId: event.depth.firstUpdateId,
          finalUpdateId: event.depth.finalUpdateId,
          bids: event.depth.bids.map((level) => ({
            price: level.price.toString(),
            quantity: level.quantity.toString()
          })),
          asks: event.depth.asks.map((level) => ({
            price: level.price.toString(),
            quantity: level.quantity.toString()
          }))
        }
      };
  }
}
