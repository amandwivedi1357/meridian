import {
  ackStreamMessage,
  ensureConsumerGroup,
  readConsumerGroup,
  type RedisStreamClient,
  type StreamFieldValue,
  type StreamMessage
} from "@meridian/bus";
import { Decimal, type BookSnapshot, type Candle, type Trade } from "@meridian/core";
import {
  marketEventProtobufCodec,
  type EventCodec,
  type MarketEventMessage
} from "@meridian/proto";

import type { LiveMarketEvent, LiveStrategyRunner } from "./live-strategy-runner.js";

export interface MarketConsumerLogger {
  readonly info: (data: Record<string, unknown>, message: string) => void;
  readonly warn: (data: Record<string, unknown>, message: string) => void;
  readonly error: (data: Record<string, unknown>, message: string) => void;
}

export interface MarketConsumerOptions {
  readonly bus: RedisStreamClient;
  readonly stream: string;
  readonly group: string;
  readonly consumer: string;
  readonly runner: Pick<LiveStrategyRunner, "handleMarketEvent">;
  readonly logger: MarketConsumerLogger;
  readonly codec?: EventCodec<MarketEventMessage>;
  readonly readCount?: number;
  readonly blockMs?: number;
}

export interface MarketConsumer {
  readonly ensureReady: () => Promise<void>;
  readonly pollOnce: () => Promise<number>;
}

export function createMarketConsumer(options: MarketConsumerOptions): MarketConsumer {
  const readCount = options.readCount ?? 10;
  const blockMs = options.blockMs ?? 1_000;

  return {
    async ensureReady() {
      await ensureConsumerGroup(options.bus, options.stream, options.group, "0");
    },

    async pollOnce() {
      const results = await readConsumerGroup(
        options.bus,
        options.group,
        options.consumer,
        options.stream,
        {
          count: readCount,
          blockMs
        }
      );

      if (results === null) return 0;

      let processed = 0;

      for (const result of results) {
        for (const message of result.messages) {
          const handled = await handleMarketMessage(message, options);
          if (handled) processed += 1;
        }
      }

      return processed;
    }
  };
}

async function handleMarketMessage(
  message: StreamMessage,
  options: MarketConsumerOptions
): Promise<boolean> {
  let event: LiveMarketEvent;

  try {
    event = parseMarketMessage(message, options.codec ?? marketEventProtobufCodec);
  } catch (error) {
    options.logger.warn(
      {
        error,
        stream: options.stream,
        messageId: message.id
      },
      "invalid market message dropped"
    );
    await ackStreamMessage(options.bus, options.stream, options.group, message.id);
    return false;
  }

  try {
    const signals = await options.runner.handleMarketEvent(event);
    await ackStreamMessage(options.bus, options.stream, options.group, message.id);

    if (signals.length > 0) {
      options.logger.info(
        {
          stream: options.stream,
          messageId: message.id,
          signals: signals.length
        },
        "market message produced signals"
      );
    }

    return true;
  } catch (error) {
    options.logger.error(
      {
        error,
        stream: options.stream,
        messageId: message.id
      },
      "market message processing failed; message left pending for retry"
    );
    return false;
  }
}

function parseMarketMessage(
  message: StreamMessage,
  codec: EventCodec<MarketEventMessage>
): LiveMarketEvent {
  const kind = readField(message.fields.kind);
  const payload = message.fields.payload;

  if (payload === undefined) {
    throw new Error("Market message payload is required");
  }

  try {
    return marketEventToLiveEvent(codec.decode(toPayloadBytes(payload)));
  } catch {
    // Keep accepting explicit debug/legacy JSON payloads while protobuf remains the default.
  }

  const parsed = JSON.parse(readField(payload) ?? "") as unknown;

  if (kind === "kline" || kind === "candle") {
    return {
      kind: "candle",
      candle: parseCandlePayload(parsed)
    };
  }

  if (kind === "trade") {
    return {
      kind: "trade",
      trade: parseTradePayload(parsed)
    };
  }

  if (kind === "book" || kind === "depth") {
    return {
      kind: "book",
      book: parseBookPayload(parsed)
    };
  }

  throw new Error(`Unsupported market message kind: ${kind ?? "unknown"}`);
}

function marketEventToLiveEvent(event: MarketEventMessage): LiveMarketEvent {
  switch (event.kind) {
    case "kline":
      return {
        kind: "candle",
        candle: event.candle
      };

    case "trade":
      return {
        kind: "trade",
        trade: event.trade
      };

    case "depth":
      return {
        kind: "book",
        book: {
          symbol: event.symbol,
          bids: event.depth.bids,
          asks: event.depth.asks,
          eventTimeMs: event.occurredAtMs
        }
      };
  }
}

function toPayloadBytes(payload: StreamFieldValue): Uint8Array {
  if (Buffer.isBuffer(payload)) return payload;
  return new TextEncoder().encode(payload);
}

function parseCandlePayload(value: unknown): Candle {
  if (value === null || typeof value !== "object") {
    throw new Error("Candle payload must be an object");
  }

  const record = value as Record<string, unknown>;
  const candle = (record.candle ?? record.kline ?? record) as Record<string, unknown>;

  return {
    symbol: readString(candle, "symbol"),
    interval: readString(candle, "interval"),
    openTimeMs: readSafeInteger(candle, "openTimeMs"),
    closeTimeMs: readSafeInteger(candle, "closeTimeMs"),
    open: readDecimal(candle, "open"),
    high: readDecimal(candle, "high"),
    low: readDecimal(candle, "low"),
    close: readDecimal(candle, "close"),
    volume: readDecimal(candle, "volume"),
    closed: readBoolean(candle, "closed")
  };
}

function parseTradePayload(value: unknown): Trade {
  if (value === null || typeof value !== "object") {
    throw new Error("Trade payload must be an object");
  }

  const record = value as Record<string, unknown>;
  const trade = (record.trade ?? record) as Record<string, unknown>;

  return {
    symbol: readString(trade, "symbol"),
    tradeId: readString(trade, "tradeId"),
    price: readDecimal(trade, "price"),
    quantity: readDecimal(trade, "quantity"),
    eventTimeMs: readSafeInteger(trade, "eventTimeMs"),
    isBuyerMaker: readBoolean(trade, "isBuyerMaker")
  };
}

function parseBookPayload(value: unknown): BookSnapshot {
  if (value === null || typeof value !== "object") {
    throw new Error("Book payload must be an object");
  }

  const record = value as Record<string, unknown>;
  const book = (record.book ?? record) as Record<string, unknown>;

  return {
    symbol: readString(book, "symbol"),
    bids: readBookLevels(book, "bids"),
    asks: readBookLevels(book, "asks"),
    eventTimeMs: readSafeInteger(book, "eventTimeMs")
  };
}

function readBookLevels(
  record: Record<string, unknown>,
  key: string
): readonly { readonly price: Decimal; readonly quantity: Decimal }[] {
  const value = record[key];

  if (!Array.isArray(value)) {
    throw new Error(`Book ${key} must be an array`);
  }

  return value.map((level) => {
    if (level === null || typeof level !== "object") {
      throw new Error(`Book ${key} levels must be objects`);
    }

    const levelRecord = level as Record<string, unknown>;

    return {
      price: readDecimal(levelRecord, "price"),
      quantity: readDecimal(levelRecord, "quantity")
    };
  });
}

function readField(value: StreamFieldValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Candle ${key} must be a nonempty string`);
  }
  return value;
}

function readSafeInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Candle ${key} must be a non-negative safe integer`);
  }
  return value as number;
}

function readDecimal(record: Record<string, unknown>, key: string): Decimal {
  return new Decimal(readString(record, key));
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`Candle ${key} must be a boolean`);
  }
  return value;
}
