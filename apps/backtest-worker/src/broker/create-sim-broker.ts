import { Decimal, type Fill } from "@meridian/core";
import type { SimBroker, SimBrokerOptions, SimulatedFill } from "./sim-broker.js";
import { validateSimBrokerOptions } from "./broker-options.js";
import { applyFill, type SimBrokerState } from "./fill-accounting.js";
import { createMarketFill } from "./market-fill.js";
import { createPendingOrders, type PendingOrder } from "./pending-orders.js";
import { calculateMarketFillPrice } from "./fill-price.js";

function isLimitTouched(
  order: PendingOrder,
  candle: Parameters<SimBroker["processCandle"]>[0]
): boolean {
  const limitPrice = order.intent.limitPrice;
  if (order.intent.type !== "LIMIT" || limitPrice === undefined) return false;

  return order.intent.side === "BUY" ? candle.low.lt(limitPrice) : candle.high.gt(limitPrice);
}

function isStopTouched(
  order: PendingOrder,
  candle: Parameters<SimBroker["processCandle"]>[0]
): boolean {
  const stopPrice = order.intent.stopPrice;
  if (order.intent.type !== "STOP_MARKET" || stopPrice === undefined) return false;

  return order.intent.side === "BUY" ? candle.high.gte(stopPrice) : candle.low.lte(stopPrice);
}

function isOrderTriggered(
  order: PendingOrder,
  candle: Parameters<SimBroker["processCandle"]>[0]
): boolean {
  if (order.intent.type === "MARKET") return true;
  if (order.intent.type === "LIMIT") return isLimitTouched(order, candle);
  return isStopTouched(order, candle);
}

function conservativeOrderPriority(order: PendingOrder): number {
  if (order.intent.type === "STOP_MARKET") return 0;
  if (order.intent.type === "MARKET") return 1;
  return 2;
}

function createLimitFill(
  order: PendingOrder,
  tsMs: number,
  options: Pick<SimBrokerOptions, "quoteAsset" | "makerFeeRate" | "takerFeeRate">
): Fill {
  const price = order.intent.limitPrice;
  if (order.intent.type !== "LIMIT" || price === undefined) {
    throw new Error("Unsupported simulated order");
  }

  const feeRate = options.makerFeeRate ?? options.takerFeeRate;
  return {
    symbol: order.intent.symbol,
    side: order.intent.side,
    quantity: order.intent.quantity,
    price,
    fee: price.times(order.intent.quantity).times(feeRate),
    feeAsset: options.quoteAsset,
    tsMs
  };
}

function createStopMarketFill(
  order: PendingOrder,
  tsMs: number,
  options: Pick<
    SimBrokerOptions,
    "symbol" | "quoteAsset" | "slippageBps" | "takerFeeRate" | "exchangeFilters"
  >
): Fill {
  const stopPrice = order.intent.stopPrice;
  if (order.intent.type !== "STOP_MARKET" || stopPrice === undefined) {
    throw new Error("Unsupported simulated order");
  }

  return createMarketFill(
    {
      ...order.intent,
      type: "MARKET"
    },
    stopPrice,
    tsMs,
    options
  );
}

export function createSimBroker(input: SimBrokerOptions): SimBroker {
  const options = { ...input };
  validateSimBrokerOptions(options);
  const queue = createPendingOrders(options.symbol);
  let lastOpenMs = -1;
  let halted = false;
  let state: SimBrokerState = {
    quoteBalance: options.initialQuoteBalance,
    feeBalances: new Map(options.initialFeeBalances ?? []),
    position: {
      symbol: options.symbol,
      quantity: new Decimal(0),
      avgEntry: new Decimal(0),
      realizedPnl: new Decimal(0)
    }
  };

  return {
    submit(intent, submittedAtMs, clientOrderId) {
      if (halted) throw new Error("Sim broker halted");
      if (submittedAtMs < lastOpenMs) {
        throw new Error("Cannot submit an order in the past");
      }
      queue.enqueue(intent, submittedAtMs, clientOrderId);
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
      const fills: SimulatedFill[] = [];
      const unfilled: PendingOrder[] = [];
      try {
        const triggered: PendingOrder[] = [];
        for (const order of queue.takeBefore(candle.openTimeMs)) {
          if (!isOrderTriggered(order, candle)) {
            unfilled.push(order);
            continue;
          }

          triggered.push(order);
        }

        triggered.sort(
          (left, right) => conservativeOrderPriority(left) - conservativeOrderPriority(right)
        );

        for (const order of triggered) {
          const fill =
            order.intent.type === "LIMIT"
              ? createLimitFill(order, candle.openTimeMs, options)
              : order.intent.type === "STOP_MARKET"
                ? createStopMarketFill(order, candle.openTimeMs, options)
                : createMarketFill(order.intent, candle.open, candle.openTimeMs, options);

          if (
            fills.length > 0 &&
            fill.side === "SELL" &&
            fill.quantity.gt(nextState.position.quantity)
          ) {
            continue;
          }

          nextState = applyFill(nextState, fill, options.quoteAsset, options.baseAsset);
          fills.push(
            order.clientOrderId === undefined
              ? fill
              : { ...fill, clientOrderId: order.clientOrderId }
          );
        }
      } catch (error) {
        halted = true;
        throw error;
      }
      queue.requeueFront(unfilled);
      state = nextState;
      lastOpenMs = candle.openTimeMs;
      return fills;
    },
    position: () => ({ ...state.position }),
    balance(asset) {
      if (asset === options.quoteAsset) return state.quoteBalance;
      if (asset === options.baseAsset) return state.position.quantity;
      const feeBalance = state.feeBalances.get(asset);
      if (feeBalance !== undefined) return feeBalance;
      return new Decimal(0);
    },
    equity(markPrice) {
      calculateMarketFillPrice(markPrice, "BUY", new Decimal(0));
      return state.quoteBalance.plus(state.position.quantity.times(markPrice));
    }
  };
}
