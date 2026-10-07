import type { Decimal } from "decimal.js";
import type { Candle, Fill, Position, SymbolCode } from "./index.js";

export type GatewayOrderType = "MARKET" | "LIMIT";

export type GatewayOrderStatus =
  | "NEW"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "REJECTED"
  | "EXPIRED"
  | "UNKNOWN";

export interface GatewayOrderRequest {
  readonly clientOrderId: string;
  readonly symbol: SymbolCode;
  readonly side: "BUY" | "SELL";
  readonly type: GatewayOrderType;
  readonly quantity: Decimal;
  readonly price?: Decimal;
  readonly timeInForce?: "GTC" | "IOC" | "FOK";
}

export interface GatewayOrderResult {
  readonly clientOrderId: string;
  readonly exchangeOrderId: string;
  readonly symbol: SymbolCode;
  readonly side: "BUY" | "SELL";
  readonly type: GatewayOrderType;
  readonly status: GatewayOrderStatus;
  readonly executedQuantity: Decimal;
  readonly cumulativeQuoteQuantity: Decimal;
  readonly fills: readonly Fill[];
  readonly eventTimeMs: number;
}

export interface GatewayOrderSnapshot
  extends Omit<GatewayOrderResult, "fills"> {
  readonly price?: Decimal;
}

export interface BalanceSnapshot {
  readonly asset: string;
  readonly free: Decimal;
  readonly locked: Decimal;
}

export interface CandleRequest {
  readonly symbol: SymbolCode;
  readonly interval: "1m" | "5m" | "15m" | "1h";
  readonly fromMs?: number;
  readonly toMs?: number;
  readonly limit?: number;
}

export interface ExchangeGateway {
  readonly placeOrder: (
    request: GatewayOrderRequest
  ) => Promise<GatewayOrderResult>;

  readonly cancelOrder: (request: {
    readonly symbol: SymbolCode;
    readonly clientOrderId: string;
  }) => Promise<GatewayOrderResult>;

  readonly getOrder: (request: {
    readonly symbol: SymbolCode;
    readonly clientOrderId: string;
  }) => Promise<GatewayOrderSnapshot>;

  readonly getOpenOrders: (request?: {
    readonly symbol?: SymbolCode;
  }) => Promise<readonly GatewayOrderSnapshot[]>;

  readonly getBalances: () => Promise<readonly BalanceSnapshot[]>;
}

export interface MarketDataSource {
  readonly getCandles: (request: CandleRequest) => AsyncIterable<Candle>;
}

export interface SimulatedExchangeGateway extends ExchangeGateway {
  readonly processCandle: (candle: Candle) => readonly Fill[];
  readonly position: (symbol?: SymbolCode) => Position;
}
