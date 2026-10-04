import { Decimal, type Fill } from "@meridian/core";
import type { SimBroker, SimBrokerOptions } from "./sim-broker.js";
import { validateSimBrokerOptions } from "./broker-options.js";
import { applyFill, type SimBrokerState } from "./fill-accounting.js";
import { createMarketFill } from "./market-fill.js";
import { createPendingOrders } from "./pending-orders.js";
import { calculateMarketFillPrice } from "./fill-price.js";

export function createSimBroker(input: SimBrokerOptions): SimBroker {
  const options = { ...input };
  validateSimBrokerOptions(options);
  const queue = createPendingOrders(options.symbol);
  let lastOpenMs = -1;
  let halted = false;
  let state: SimBrokerState = {
    quoteBalance: options.initialQuoteBalance,
    position: {
      symbol: options.symbol,
      quantity: new Decimal(0),
      avgEntry: new Decimal(0),
      realizedPnl: new Decimal(0)
    }
  };

  return {
    submit(intent, submittedAtMs) {
      if (halted) throw new Error("Sim broker halted");
      if (submittedAtMs < lastOpenMs) {
        throw new Error("Cannot submit an order in the past");
      }
      queue.enqueue(intent, submittedAtMs);
    },
    processCandle(candle) {
      if (halted) throw new Error("Sim broker halted");
      if (!candle.closed || candle.symbol !== options.symbol) return [];
      if (
        !Number.isSafeInteger(candle.openTimeMs) ||
        candle.openTimeMs < 0 ||
        candle.openTimeMs <= lastOpenMs
      ) {
        throw new Error("Candles must have increasing valid timestamps");
      }
      calculateMarketFillPrice(candle.open, "BUY", options.slippageBps);
      let nextState = state;
      const fills: Fill[] = [];
      try {
        for (const order of queue.takeBefore(candle.openTimeMs)) {
          const fill = createMarketFill(order.intent, candle.open, candle.openTimeMs, options);
          nextState = applyFill(nextState, fill, options.quoteAsset);
          fills.push(fill);
        }
      } catch (error) {
        halted = true;
        throw error;
      }
      state = nextState;
      lastOpenMs = candle.openTimeMs;
      return fills;
    },
    position: () => ({ ...state.position }),
    balance(asset) {
      if (asset === options.quoteAsset) return state.quoteBalance;
      if (asset === options.baseAsset) return state.position.quantity;
      return new Decimal(0);
    },
    equity(markPrice) {
      calculateMarketFillPrice(markPrice, "BUY", new Decimal(0));
      return state.quoteBalance.plus(state.position.quantity.times(markPrice));
    }
  };
}
