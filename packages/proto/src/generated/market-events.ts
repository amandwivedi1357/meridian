/* Generated protobuf wire codec for meridian.market.v1 MarketEvent. */

export interface WireBookLevel {
  readonly price: string;
  readonly quantity: string;
}

export interface WireTrade {
  readonly symbol: string;
  readonly tradeId: string;
  readonly price: string;
  readonly quantity: string;
  readonly eventTimeMs: number;
  readonly isBuyerMaker: boolean;
}

export interface WireCandle {
  readonly symbol: string;
  readonly interval: string;
  readonly openTimeMs: number;
  readonly closeTimeMs: number;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string;
  readonly closed: boolean;
}

export interface WireDepth {
  readonly firstUpdateId: number;
  readonly finalUpdateId: number;
  readonly bids: readonly WireBookLevel[];
  readonly asks: readonly WireBookLevel[];
}

export interface WireMarketEvent {
  readonly schemaVersion: string;
  readonly kind: "trade" | "kline" | "depth";
  readonly symbol: string;
  readonly eventId: string;
  readonly occurredAtMs: number;
  readonly trade?: WireTrade;
  readonly candle?: WireCandle;
  readonly depth?: WireDepth;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export function encodeMarketEventMessage(message: WireMarketEvent): Uint8Array {
  const writer = new ProtoWriter();
  writer.string(1, message.schemaVersion);
  writer.string(2, message.kind);
  writer.string(3, message.symbol);
  writer.string(4, message.eventId);
  writer.uint64(5, message.occurredAtMs);
  if (message.trade !== undefined) writer.message(10, encodeTrade(message.trade));
  if (message.candle !== undefined) writer.message(11, encodeCandle(message.candle));
  if (message.depth !== undefined) writer.message(12, encodeDepth(message.depth));
  return writer.finish();
}

export function decodeMarketEventMessage(bytes: Uint8Array): WireMarketEvent {
  const reader = new ProtoReader(bytes);
  const partial: Partial<Mutable<WireMarketEvent>> = {};
  while (!reader.done()) {
    const tag = reader.tag();
    switch (tag.fieldNumber) {
      case 1:
        partial.schemaVersion = reader.string(tag);
        break;
      case 2:
        partial.kind = readKind(reader.string(tag));
        break;
      case 3:
        partial.symbol = reader.string(tag);
        break;
      case 4:
        partial.eventId = reader.string(tag);
        break;
      case 5:
        partial.occurredAtMs = reader.uint64(tag);
        break;
      case 10:
        partial.trade = decodeTrade(reader.bytes(tag));
        break;
      case 11:
        partial.candle = decodeCandle(reader.bytes(tag));
        break;
      case 12:
        partial.depth = decodeDepth(reader.bytes(tag));
        break;
      default:
        reader.skip(tag);
    }
  }
  return requireMarketEvent(partial);
}

function encodeTrade(trade: WireTrade): Uint8Array {
  const writer = new ProtoWriter();
  writer.string(1, trade.symbol);
  writer.string(2, trade.tradeId);
  writer.string(3, trade.price);
  writer.string(4, trade.quantity);
  writer.uint64(5, trade.eventTimeMs);
  writer.bool(6, trade.isBuyerMaker);
  return writer.finish();
}

function decodeTrade(bytes: Uint8Array): WireTrade {
  const reader = new ProtoReader(bytes);
  const partial: Partial<Mutable<WireTrade>> = {};
  while (!reader.done()) {
    const tag = reader.tag();
    switch (tag.fieldNumber) {
      case 1:
        partial.symbol = reader.string(tag);
        break;
      case 2:
        partial.tradeId = reader.string(tag);
        break;
      case 3:
        partial.price = reader.string(tag);
        break;
      case 4:
        partial.quantity = reader.string(tag);
        break;
      case 5:
        partial.eventTimeMs = reader.uint64(tag);
        break;
      case 6:
        partial.isBuyerMaker = reader.bool(tag);
        break;
      default:
        reader.skip(tag);
    }
  }
  return requireFields(partial, ["symbol", "tradeId", "price", "quantity", "eventTimeMs", "isBuyerMaker"], "trade");
}

function encodeCandle(candle: WireCandle): Uint8Array {
  const writer = new ProtoWriter();
  writer.string(1, candle.symbol);
  writer.string(2, candle.interval);
  writer.uint64(3, candle.openTimeMs);
  writer.uint64(4, candle.closeTimeMs);
  writer.string(5, candle.open);
  writer.string(6, candle.high);
  writer.string(7, candle.low);
  writer.string(8, candle.close);
  writer.string(9, candle.volume);
  writer.bool(10, candle.closed);
  return writer.finish();
}

function decodeCandle(bytes: Uint8Array): WireCandle {
  const reader = new ProtoReader(bytes);
  const partial: Partial<Mutable<WireCandle>> = {};
  while (!reader.done()) {
    const tag = reader.tag();
    switch (tag.fieldNumber) {
      case 1:
        partial.symbol = reader.string(tag);
        break;
      case 2:
        partial.interval = reader.string(tag);
        break;
      case 3:
        partial.openTimeMs = reader.uint64(tag);
        break;
      case 4:
        partial.closeTimeMs = reader.uint64(tag);
        break;
      case 5:
        partial.open = reader.string(tag);
        break;
      case 6:
        partial.high = reader.string(tag);
        break;
      case 7:
        partial.low = reader.string(tag);
        break;
      case 8:
        partial.close = reader.string(tag);
        break;
      case 9:
        partial.volume = reader.string(tag);
        break;
      case 10:
        partial.closed = reader.bool(tag);
        break;
      default:
        reader.skip(tag);
    }
  }
  return requireFields(
    partial,
    ["symbol", "interval", "openTimeMs", "closeTimeMs", "open", "high", "low", "close", "volume", "closed"],
    "candle"
  );
}

function encodeDepth(depth: WireDepth): Uint8Array {
  const writer = new ProtoWriter();
  writer.uint64(1, depth.firstUpdateId);
  writer.uint64(2, depth.finalUpdateId);
  for (const bid of depth.bids) writer.message(3, encodeBookLevel(bid));
  for (const ask of depth.asks) writer.message(4, encodeBookLevel(ask));
  return writer.finish();
}

function decodeDepth(bytes: Uint8Array): WireDepth {
  const reader = new ProtoReader(bytes);
  const partial: Partial<Mutable<WireDepth>> & { bids: WireBookLevel[]; asks: WireBookLevel[] } = {
    bids: [],
    asks: []
  };
  while (!reader.done()) {
    const tag = reader.tag();
    switch (tag.fieldNumber) {
      case 1:
        partial.firstUpdateId = reader.uint64(tag);
        break;
      case 2:
        partial.finalUpdateId = reader.uint64(tag);
        break;
      case 3:
        partial.bids.push(decodeBookLevel(reader.bytes(tag)));
        break;
      case 4:
        partial.asks.push(decodeBookLevel(reader.bytes(tag)));
        break;
      default:
        reader.skip(tag);
    }
  }
  return requireFields(partial, ["firstUpdateId", "finalUpdateId", "bids", "asks"], "depth");
}

function encodeBookLevel(level: WireBookLevel): Uint8Array {
  const writer = new ProtoWriter();
  writer.string(1, level.price);
  writer.string(2, level.quantity);
  return writer.finish();
}

function decodeBookLevel(bytes: Uint8Array): WireBookLevel {
  const reader = new ProtoReader(bytes);
  const partial: Partial<Mutable<WireBookLevel>> = {};
  while (!reader.done()) {
    const tag = reader.tag();
    switch (tag.fieldNumber) {
      case 1:
        partial.price = reader.string(tag);
        break;
      case 2:
        partial.quantity = reader.string(tag);
        break;
      default:
        reader.skip(tag);
    }
  }
  return requireFields(partial, ["price", "quantity"], "book level");
}

function requireMarketEvent(partial: Partial<WireMarketEvent>): WireMarketEvent {
  const message = requireFields(
    partial,
    ["schemaVersion", "kind", "symbol", "eventId", "occurredAtMs"],
    "market event"
  );
  if (message.kind === "trade" && message.trade === undefined) throw new Error("Invalid market event: missing trade");
  if (message.kind === "kline" && message.candle === undefined) throw new Error("Invalid market event: missing candle");
  if (message.kind === "depth" && message.depth === undefined) throw new Error("Invalid market event: missing depth");
  return message;
}

function requireFields<T extends object, K extends keyof T>(
  partial: Partial<T>,
  fields: readonly K[],
  label: string
): T {
  for (const field of fields) {
    if (partial[field] === undefined) {
      throw new Error(`Invalid ${label}: missing ${String(field)}`);
    }
  }
  return partial as T;
}

function readKind(value: string): WireMarketEvent["kind"] {
  if (value === "trade" || value === "kline" || value === "depth") return value;
  throw new Error("Invalid market event kind");
}

class ProtoWriter {
  private readonly chunks: number[] = [];

  string(fieldNumber: number, value: string): void {
    this.bytes(fieldNumber, textEncoder.encode(value));
  }

  message(fieldNumber: number, value: Uint8Array): void {
    this.bytes(fieldNumber, value);
  }

  bytes(fieldNumber: number, value: Uint8Array): void {
    this.tag(fieldNumber, 2);
    this.varint(value.length);
    this.chunks.push(...value);
  }

  uint64(fieldNumber: number, value: number): void {
    this.tag(fieldNumber, 0);
    this.varint(value);
  }

  bool(fieldNumber: number, value: boolean): void {
    this.tag(fieldNumber, 0);
    this.varint(value ? 1 : 0);
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }

  private tag(fieldNumber: number, wireType: number): void {
    this.varint(fieldNumber * 8 + wireType);
  }

  private varint(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid uint64 value");
    let next = BigInt(value);
    while (next >= 0x80n) {
      this.chunks.push(Number((next & 0x7fn) | 0x80n));
      next >>= 7n;
    }
    this.chunks.push(Number(next));
  }
}

interface ProtoTag {
  readonly fieldNumber: number;
  readonly wireType: number;
}

class ProtoReader {
  private offset = 0;

  constructor(private readonly bytesValue: Uint8Array) {}

  done(): boolean {
    return this.offset >= this.bytesValue.length;
  }

  tag(): ProtoTag {
    const value = this.varint();
    return {
      fieldNumber: Math.floor(value / 8),
      wireType: value % 8
    };
  }

  string(tag: ProtoTag): string {
    return textDecoder.decode(this.bytes(tag));
  }

  bytes(tag: ProtoTag): Uint8Array {
    this.expectWireType(tag, 2);
    const length = this.varint();
    const end = this.offset + length;
    if (end > this.bytesValue.length) throw new Error("Invalid protobuf length");
    const value = this.bytesValue.slice(this.offset, end);
    this.offset = end;
    return value;
  }

  uint64(tag: ProtoTag): number {
    this.expectWireType(tag, 0);
    return this.varint();
  }

  bool(tag: ProtoTag): boolean {
    const value = this.uint64(tag);
    if (value !== 0 && value !== 1) throw new Error("Invalid protobuf bool");
    return value === 1;
  }

  skip(tag: ProtoTag): void {
    if (tag.wireType === 0) {
      this.varint();
      return;
    }
    if (tag.wireType === 2) {
      this.bytes(tag);
      return;
    }
    throw new Error(`Unsupported protobuf wire type ${tag.wireType}`);
  }

  private varint(): number {
    let shift = 0n;
    let result = 0n;
    while (this.offset < this.bytesValue.length) {
      const byte = this.bytesValue[this.offset];
      if (byte === undefined) throw new Error("Invalid protobuf varint");
      this.offset += 1;
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        const value = Number(result);
        if (!Number.isSafeInteger(value)) throw new Error("Protobuf uint64 exceeds safe integer range");
        return value;
      }
      shift += 7n;
    }
    throw new Error("Truncated protobuf varint");
  }

  private expectWireType(tag: ProtoTag, wireType: number): void {
    if (tag.wireType !== wireType) {
      throw new Error(`Invalid protobuf wire type: expected ${wireType}, got ${tag.wireType}`);
    }
  }
}
