import type { Candle } from "@meridian/core";

export interface CandleFeedRequest {
  readonly symbol: string;
  readonly interval: "15m" | "1h";
  readonly fromMs: number;
  readonly toMs: number;
}

export interface CandleFeed {
  readonly read: (request: CandleFeedRequest) => AsyncIterable<Candle>;
}
