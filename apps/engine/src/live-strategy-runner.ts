import { createHash } from "node:crypto";

import {
  Decimal,
  createSignal,
  type BookSnapshot,
  type Candle,
  type OrderIntent,
  type Position,
  type Signal,
  type Strategy,
  type StrategyContext,
  type SymbolCode
} from "@meridian/core";

export type LiveMarketEvent =
  | {
      readonly kind: "candle";
      readonly candle: Candle;
    }
  | {
      readonly kind: "trade";
      readonly trade: import("@meridian/core").Trade;
    }
  | {
      readonly kind: "book";
      readonly book: BookSnapshot;
    };

export interface LiveStrategyLogger {
  readonly info?: (data: Record<string, unknown>, message: string) => void;
  readonly warn?: (data: Record<string, unknown>, message: string) => void;
  readonly error?: (data: Record<string, unknown>, message: string) => void;
}

export interface LiveStrategyRunnerDeps {
  readonly strategy: Strategy;
  readonly publishSignal: (signal: Signal) => Promise<string>;
  readonly nowMs: () => number;
  readonly signalTtlMs: number;
  readonly maxMarketDataAgeMs?: number;
  readonly position?: (symbol: SymbolCode) => Position;
  readonly balance?: (asset: string) => Decimal;
  readonly logger?: LiveStrategyLogger;
  readonly accountState?: LiveAccountStateReader;
}

export interface LiveAccountStateReader {
  readonly refresh: () => Promise<void>;
  readonly position: (symbol: SymbolCode) => Position;
  readonly balance: (asset: string) => Decimal;
}

export interface LiveStrategyRunner {
  readonly start: () => Promise<void>;
  readonly handleMarketEvent: (event: LiveMarketEvent) => Promise<readonly Signal[]>;
}

export function createLiveStrategyRunner(deps: LiveStrategyRunnerDeps): LiveStrategyRunner {
  let started = false;

  return {
    async start() {
      if (started) return;

      await deps.accountState?.refresh();

      const context = createContext(deps, []);
      await deps.strategy.onInit?.(context);
      started = true;
    },

    async handleMarketEvent(event) {
      if (!started) {
        await this.start();
      }

      const nowMs = deps.nowMs();
      const ageMs = nowMs - eventTimeMs(event);

      if (
        deps.maxMarketDataAgeMs !== undefined &&
        (ageMs < 0 || ageMs > deps.maxMarketDataAgeMs)
      ) {
        deps.logger?.warn?.(
          {
            strategyId: deps.strategy.id,
            eventTimeMs: eventTimeMs(event),
            nowMs,
            ageMs,
            maxMarketDataAgeMs: deps.maxMarketDataAgeMs
          },
          "stale market event ignored"
        );
        return [];
      }

      await deps.accountState?.refresh();

      const submitted: OrderIntent[] = [];
      const context = createContext(deps, submitted);

      switch (event.kind) {
        case "candle":
          deps.strategy.onCandle?.(event.candle, context);
          break;
        case "trade":
          deps.strategy.onTrade?.(event.trade, context);
          break;
        case "book":
          deps.strategy.onOrderBook?.(event.book, context);
          break;
      }

      const createdAtMs = nowMs;
      const validUntilMs = createdAtMs + deps.signalTtlMs;
      const signals = submitted.map((intent, index) =>
        createSignal({
          signalId: createSignalId({
            strategyId: deps.strategy.id,
            eventTimeMs: eventTimeMs(event),
            intent,
            index
          }),
          strategyId: deps.strategy.id,
          createdAtMs,
          validUntilMs,
          intent
        })
      );

      for (const signal of signals) {
        await deps.publishSignal(signal);
      }

      return signals;
    }
  };
}

function createContext(deps: LiveStrategyRunnerDeps, submitted: OrderIntent[]): StrategyContext {
  return {
    now: deps.nowMs,

    position(symbol) {
      return (
        deps.accountState?.position(symbol) ??
        deps.position?.(symbol) ?? {
          symbol,
          quantity: new Decimal(0),
          avgEntry: new Decimal(0),
          realizedPnl: new Decimal(0)
        }
      );
    },

    balance(asset) {
      return deps.accountState?.balance(asset) ?? deps.balance?.(asset) ?? new Decimal(0);
    },

    submit(intent) {
      submitted.push(intent);
    },

    log(message, data) {
      deps.logger?.info?.(
        {
          strategyId: deps.strategy.id,
          ...(data ?? {})
        },
        message
      );
    }
  };
}

function eventTimeMs(event: LiveMarketEvent): number {
  switch (event.kind) {
    case "candle":
      return event.candle.closeTimeMs;
    case "trade":
      return event.trade.eventTimeMs;
    case "book":
      return event.book.eventTimeMs;
  }
}

function createSignalId(input: {
  readonly strategyId: string;
  readonly eventTimeMs: number;
  readonly intent: OrderIntent;
  readonly index: number;
}): string {
  const hash = createHash("sha256")
    .update(input.strategyId)
    .update("\0")
    .update(String(input.eventTimeMs))
    .update("\0")
    .update(String(input.index))
    .update("\0")
    .update(input.intent.symbol)
    .update("\0")
    .update(input.intent.side)
    .update("\0")
    .update(input.intent.type)
    .update("\0")
    .update(input.intent.quantity.toFixed())
    .update("\0")
    .update(input.intent.limitPrice?.toFixed() ?? "")
    .update("\0")
    .update(input.intent.reason)
    .digest("base64url");

  return `sig_${hash.slice(0, 32)}`;
}
