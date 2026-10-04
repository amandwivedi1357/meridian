import type { Candle, Decimal, Fill, OrderIntent, Position } from "@meridian/core";

export interface SimBrokerOptions {
  readonly symbol: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly initialQuoteBalance: Decimal;
  readonly slippageBps: Decimal;
  readonly takerFeeRate: Decimal;
}

export interface SimBroker {
  readonly submit: (intent: OrderIntent, submittedAtMs: number) => void;

  readonly processCandle: (candle: Candle) => readonly Fill[];

  readonly position: () => Position;

  readonly balance: (asset: string) => Decimal;

  readonly equity: (markPrice: Decimal) => Decimal;
}
