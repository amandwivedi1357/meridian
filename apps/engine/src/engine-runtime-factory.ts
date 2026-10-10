import { marketKlineStream, type RedisStreamClient } from "@meridian/bus";
import type { Strategy } from "@meridian/core";
import { createEngineRuntime, type EngineRuntime } from "./engine-runtime.js";
import {
  createLiveStrategyRunner,
  type LiveAccountStateReader,
  type LiveStrategyLogger
} from "./live-strategy-runner.js";
import { createMarketConsumer, type MarketConsumerLogger } from "./market-consumer.js";
import { publishSignal } from "./signal-publisher.js";

export interface EngineRuntimeFactoryDeps {
  readonly bus: RedisStreamClient;
  readonly strategy: Strategy;
  readonly symbol: string;
  readonly interval: "1m" | "5m" | "15m" | "1h";
  readonly logger: MarketConsumerLogger & LiveStrategyLogger;
  readonly group: string;
  readonly consumer: string;
  readonly signalTtlMs: number;
  readonly maxMarketDataAgeMs: number;
  readonly accountState?: LiveAccountStateReader;
  readonly isStrategyPaused?: (strategyId: string) => Promise<boolean>;
  readonly nowMs?: () => number;
  readonly readCount?: number;
  readonly blockMs?: number;
}

export function createEngineRuntimeFromDeps(deps: EngineRuntimeFactoryDeps): EngineRuntime {
  const runner = createLiveStrategyRunner({
    strategy: deps.strategy,
    publishSignal(signal) {
      return publishSignal(
        signal,
        {
          bus: deps.bus
        }
      );
    },
    nowMs: deps.nowMs ?? Date.now,
    signalTtlMs: deps.signalTtlMs,
    maxMarketDataAgeMs: deps.maxMarketDataAgeMs,
    logger: deps.logger,
    ...(deps.isStrategyPaused === undefined ? {} : { isStrategyPaused: deps.isStrategyPaused }),
    ...(deps.accountState === undefined ? {} : { accountState: deps.accountState })
  });

  const marketConsumer = createMarketConsumer({
    bus: deps.bus,
    stream: marketKlineStream(deps.symbol, deps.interval),
    group: deps.group,
    consumer: deps.consumer,
    runner,
    logger: deps.logger,
    ...(deps.readCount === undefined ? {} : { readCount: deps.readCount }),
    ...(deps.blockMs === undefined ? {} : { blockMs: deps.blockMs })
  });

  return createEngineRuntime({
    marketConsumers: [marketConsumer]
  });
}
