export interface BinanceTradeStreamPayload {
  readonly e: "trade";
  readonly E: number; // event time
  readonly s: string; // symbol
  readonly t: number; // trade id
  readonly p: string; // price
  readonly q: string; // quantity
  readonly b: number; // buyer order id
  readonly a: number; // seller order id
  readonly T: number; // trade time
  readonly m: boolean; // buyer is market maker
  readonly M: boolean; // ignore
}

export interface BinanceKlinePayload {
  readonly t: number; // kline start time
  readonly T: number; // kline close time
  readonly s: string; // symbol
  readonly i: string; // interval
  readonly f: number; // first trade id
  readonly L: number; // last trade id
  readonly o: string; // open
  readonly c: string; // close
  readonly h: string; // high
  readonly l: string; // low
  readonly v: string; // base asset volume
  readonly n: number; // number of trades
  readonly x: boolean; // is closed
  readonly q: string; // quote asset volume
  readonly V: string; // taker buy base asset volume
  readonly Q: string; // taker buy quote asset volume
  readonly B: string; // ignore
}

export interface BinanceKlineStreamPayload {
  readonly e: "kline";
  readonly E: number;
  readonly s: string;
  readonly k: BinanceKlinePayload;
}

export interface BinanceDepthStreamPayload {
  readonly e: "depthUpdate";
  readonly E: number;
  readonly s: string;
  readonly U: number;
  readonly u: number;
  readonly b: readonly (readonly [price: string, quantity: string])[];
  readonly a: readonly (readonly [price: string, quantity: string])[];
}

export type BinanceStreamPayload =
  | BinanceTradeStreamPayload
  | BinanceKlineStreamPayload
  | BinanceDepthStreamPayload;