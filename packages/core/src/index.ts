import { Decimal } from "decimal.js";
export * from "./decimal.js";
export * from "./indicators.js";
export * from "./exchange.js";
export * from "./order-lifecycle.js";
export * from "./client-order-id.js";
export * from "./order-reconciliation.js";
export * from "./signal.js";
export * from "./testnet-allocation.js";
export type SymbolCode = string;
export type StrategyId = string;

export type Side = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT" | "STOP_MARKET";

export interface Candle {
  readonly symbol: SymbolCode;
  readonly interval: string;
  readonly openTimeMs: number;
  readonly closeTimeMs: number;
  readonly open: Decimal;
  readonly high: Decimal;
  readonly low: Decimal;
  readonly close: Decimal;
  readonly volume: Decimal;
  readonly closed: boolean;
}

export interface Trade {
  readonly symbol: SymbolCode;
  readonly tradeId: string;
  readonly price: Decimal;
  readonly quantity: Decimal;
  readonly eventTimeMs: number;
  readonly isBuyerMaker: boolean;
}

export interface BookLevel {
  readonly price: Decimal;
  readonly quantity: Decimal;
}

export interface BookSnapshot {
  readonly symbol: SymbolCode;
  readonly bids: readonly BookLevel[];
  readonly asks: readonly BookLevel[];
  readonly eventTimeMs: number;
}

export interface Position {
  readonly symbol: SymbolCode;
  readonly quantity: Decimal;
  readonly avgEntry: Decimal;
  readonly realizedPnl: Decimal;
}

export interface OrderIntent {
  readonly symbol: SymbolCode;
  readonly side: Side;
  readonly type: OrderType;
  readonly quantity: Decimal;
  readonly limitPrice?: Decimal;
  readonly stopPrice?: Decimal;
  readonly reason: string;
}

export interface Fill {
  readonly symbol: SymbolCode;
  readonly side: Side;
  readonly quantity: Decimal;
  readonly price: Decimal;
  readonly fee: Decimal;
  readonly feeAsset: string;
  readonly tsMs: number;
}

export interface StrategyContext {
  now(): number;
  position(symbol: SymbolCode): Position;
  balance(asset: string): Decimal;
  submit(intent: OrderIntent): void;
  log(message: string, data?: Record<string, unknown>): void;
}

export interface Strategy {
  readonly id: StrategyId;
  onInit?(ctx: StrategyContext): void | Promise<void>;
  onCandle?(candle: Candle, ctx: StrategyContext): void;
  onTrade?(trade: Trade, ctx: StrategyContext): void;
  onOrderBook?(book: BookSnapshot, ctx: StrategyContext): void;
  onFill?(fill: Fill, ctx: StrategyContext): void;
}

export { Decimal };
