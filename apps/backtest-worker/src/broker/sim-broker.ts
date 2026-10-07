import type { Candle, Decimal, ExchangeFilters, Fill, OrderIntent, Position } from "@meridian/core";
export interface SimBrokerOptions {
  readonly symbol: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly initialQuoteBalance: Decimal;
  readonly slippageBps: Decimal;
  readonly takerFeeRate: Decimal;
  readonly makerFeeRate?: Decimal;
  readonly initialFeeBalances?: ReadonlyMap<string, Decimal>;
  readonly exchangeFilters?: ExchangeFilters;
}

export interface SimBroker {
  readonly submit: (intent: OrderIntent, submittedAtMs: number, clientOrderId?: string) => void;

  readonly processCandle: (candle: Candle) => readonly SimulatedFill[];

  readonly position: () => Position;

  readonly balance: (asset: string) => Decimal;

  readonly equity: (markPrice: Decimal) => Decimal;
}

export interface SimulatedFill extends Fill {
  readonly clientOrderId?: string;
}
