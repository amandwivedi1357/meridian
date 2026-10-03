export interface BinanceServerTimeResponse{
    readonly serverTime: number;
}

export interface BinanceRateLimit {
  readonly rateLimitType: string;
  readonly interval: string;
  readonly intervalNum: number;
  readonly limit: number;
}

export interface BinanceExchangeFilter {
  readonly filterType: string;
  readonly [key: string]: unknown;
}

export interface BinanceSymbolInfo {
  readonly symbol: string;
  readonly status: string;
  readonly baseAsset: string;
  readonly baseAssetPrecision: number;
  readonly quoteAsset: string;
  readonly quotePrecision: number;
  readonly quoteAssetPrecision: number;
  readonly orderTypes: readonly string[];
  readonly icebergAllowed: boolean;
  readonly ocoAllowed: boolean;
  readonly otoAllowed?: boolean;
  readonly quoteOrderQtyMarketAllowed: boolean;
  readonly allowTrailingStop: boolean;
  readonly cancelReplaceAllowed: boolean;
  readonly isSpotTradingAllowed: boolean;
  readonly isMarginTradingAllowed: boolean;
  readonly filters: readonly BinanceExchangeFilter[];
  readonly permissions: readonly string[];
  readonly permissionSets?: readonly (readonly string[])[];
  readonly defaultSelfTradePreventionMode?: string;
  readonly allowedSelfTradePreventionModes?: readonly string[];
}

export interface BinanceExchangeInfoResponse {
  readonly timezone: string;
  readonly serverTime: number;
  readonly rateLimits: readonly BinanceRateLimit[];
  readonly exchangeFilters: readonly BinanceExchangeFilter[];
  readonly symbols: readonly BinanceSymbolInfo[];
}

export interface BinanceDepthResponse {
  readonly lastUpdateId: number;
  readonly bids: readonly (readonly [price: string, quantity: string])[];
  readonly asks: readonly (readonly [price: string, quantity: string])[];
}

export type BinanceKlineResponse = readonly [
  openTime: number,
  open: string,
  high: string,
  low: string,
  close: string,
  volume: string,
  closeTime: number,
  quoteAssetVolume: string,
  numberOfTrades: number,
  takerBuyBaseAssetVolume: string,
  takerBuyQuoteAssetVolume: string,
  unused: string
];

export type BinanceKlinesResponse = readonly BinanceKlineResponse[];