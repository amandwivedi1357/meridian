import type { StrategyContext } from "@meridian/core";
import type { SimBroker } from "../broker/sim-broker.js";

export function createBacktestContext(
  broker: SimBroker,
  now: () => number,
  log: StrategyContext["log"] = () => {}
): StrategyContext {
  return {
    now,

    position(symbol) {
      const position = broker.position();
      if (position.symbol !== symbol) {
        throw new Error("Unsupported strategy symbol");
      }
      return position;
    },

    balance(asset) {
      return broker.balance(asset);
    },

    submit(intent) {
      broker.submit(intent, now());
    },

    log
  };
}
