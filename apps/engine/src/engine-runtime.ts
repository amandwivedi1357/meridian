import type { MarketConsumer } from "./market-consumer.js";

export interface EngineRuntime {
  readonly start: () => Promise<void>;
  readonly pollMarketOnce: () => Promise<number>;
}

export interface EngineRuntimeOptions {
  readonly marketConsumers: readonly MarketConsumer[];
}

export function createEngineRuntime(options: EngineRuntimeOptions): EngineRuntime {
  return {
    async start() {
      for (const consumer of options.marketConsumers) {
        await consumer.ensureReady();
      }
    },

    async pollMarketOnce() {
      let processed = 0;

      for (const consumer of options.marketConsumers) {
        processed += await consumer.pollOnce();
      }

      return processed;
    }
  };
}
