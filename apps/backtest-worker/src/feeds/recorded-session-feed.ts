import { readFile } from "node:fs/promises";
import { Decimal, type Candle } from "@meridian/core";
import type { CandleFeed } from "./candle-feed.js";

interface RecordedSessionFeedDeps {
  readonly readFile?: (path: string, encoding: "utf8") => Promise<string>;
}

interface RecordedKlineRecord {
  readonly kind: "kline";
  readonly symbol: string;
  readonly candle: {
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
  };
}

export function createRecordedSessionCandleFeed(
  filePath: string,
  deps: RecordedSessionFeedDeps = {}
): CandleFeed {
  const load = deps.readFile ?? readFile;

  return {
    async *read(request) {
      if (
        !Number.isSafeInteger(request.fromMs) ||
        !Number.isSafeInteger(request.toMs) ||
        request.fromMs >= request.toMs ||
        !Number.isFinite(new Date(request.fromMs).getTime()) ||
        !Number.isFinite(new Date(request.toMs).getTime())
      ) {
        throw new Error("Invalid recorded session feed time range");
      }

      const text = await load(filePath, "utf8");
      const candles = parseRecordedCandles(text)
        .filter(
          (candle) =>
            candle.symbol === request.symbol &&
            candle.interval === request.interval &&
            candle.closed &&
            candle.openTimeMs >= request.fromMs &&
            candle.closeTimeMs < request.toMs
        )
        .sort((left, right) => left.openTimeMs - right.openTimeMs);

      for (const candle of candles) yield candle;
    }
  };
}

function parseRecordedCandles(text: string): Candle[] {
  const candles: Candle[] = [];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index]?.trim();
    if (!rawLine) continue;

    let record: unknown;
    try {
      record = JSON.parse(rawLine);
    } catch {
      throw new Error(`Invalid recorded session line ${index + 1}`);
    }

    if (!isObject(record) || record.kind !== "kline") continue;
    if (!isRecordedKlineRecord(record)) {
      throw new Error("Invalid recorded kline candle");
    }

    const kline = record as unknown as RecordedKlineRecord;
    candles.push({
      symbol: kline.candle.symbol,
      interval: kline.candle.interval,
      openTimeMs: kline.candle.openTimeMs,
      closeTimeMs: kline.candle.closeTimeMs,
      open: new Decimal(kline.candle.open),
      high: new Decimal(kline.candle.high),
      low: new Decimal(kline.candle.low),
      close: new Decimal(kline.candle.close),
      volume: new Decimal(kline.candle.volume),
      closed: kline.candle.closed
    });
  }

  return candles;
}

function isRecordedKlineRecord(value: Record<string, unknown>): boolean {
  if (value.kind !== "kline" || typeof value.symbol !== "string" || !isObject(value.candle)) {
    return false;
  }

  const candle = value.candle;
  return (
    candle.symbol === value.symbol &&
    typeof candle.interval === "string" &&
    Number.isSafeInteger(candle.openTimeMs) &&
    Number.isSafeInteger(candle.closeTimeMs) &&
    typeof candle.open === "string" &&
    typeof candle.high === "string" &&
    typeof candle.low === "string" &&
    typeof candle.close === "string" &&
    typeof candle.volume === "string" &&
    typeof candle.closed === "boolean"
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
