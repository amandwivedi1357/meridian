import type { Decimal, Signal } from "@meridian/core";

import type { RiskDecision, SignalRiskGate } from "./signal-execution.js";

export interface BasicRiskGateLimits {
  readonly minNotional?: Decimal;
  readonly maxNotional?: Decimal;
  readonly maxQuantity?: Decimal;
  readonly maxAbsolutePosition?: Decimal;
  readonly maxOpenOrders?: number;
}

export interface BasicRiskGateState {
  readonly marketPrice?: (symbol: string) => Promise<Decimal>;
  readonly positionQuantity?: (symbol: string) => Promise<Decimal>;
  readonly openOrderCount?: (symbol: string) => Promise<number>;
}

export interface BasicRiskGateOptions {
  readonly limits: BasicRiskGateLimits;
  readonly state?: BasicRiskGateState;
}

export function createBasicRiskGate(options: BasicRiskGateOptions): SignalRiskGate {
  return {
    async evaluate(signal) {
      try {
        return await evaluateSignal(signal, options);
      } catch (error) {
        return {
          approved: false,
          reason: `risk-check-error:${error instanceof Error ? error.message : "unknown"}`
        };
      }
    }
  };
}

async function evaluateSignal(
  signal: Signal,
  options: BasicRiskGateOptions
): Promise<RiskDecision> {
  const quantityDecision = checkQuantity(signal, options.limits);
  if (!quantityDecision.approved) return quantityDecision;

  const notionalDecision = await checkNotional(signal, options);
  if (!notionalDecision.approved) return notionalDecision;

  const positionDecision = await checkPosition(signal, options);
  if (!positionDecision.approved) return positionDecision;

  const openOrdersDecision = await checkOpenOrders(signal, options);
  if (!openOrdersDecision.approved) return openOrdersDecision;

  return { approved: true };
}

function checkQuantity(signal: Signal, limits: BasicRiskGateLimits): RiskDecision {
  if (limits.maxQuantity !== undefined && signal.intent.quantity.gt(limits.maxQuantity)) {
    return {
      approved: false,
      reason: "quantity-above-limit"
    };
  }

  return { approved: true };
}

async function checkNotional(signal: Signal, options: BasicRiskGateOptions): Promise<RiskDecision> {
  if (options.limits.minNotional === undefined && options.limits.maxNotional === undefined) {
    return { approved: true };
  }

  const price = await resolvePrice(signal, options.state);
  const notional = signal.intent.quantity.mul(price);

  if (options.limits.minNotional !== undefined && notional.lt(options.limits.minNotional)) {
    return {
      approved: false,
      reason: "notional-below-minimum"
    };
  }

  if (options.limits.maxNotional !== undefined && notional.gt(options.limits.maxNotional)) {
    return {
      approved: false,
      reason: "notional-above-limit"
    };
  }

  return { approved: true };
}

async function checkPosition(signal: Signal, options: BasicRiskGateOptions): Promise<RiskDecision> {
  if (options.limits.maxAbsolutePosition === undefined) {
    return { approved: true };
  }

  if (options.state?.positionQuantity === undefined) {
    return {
      approved: false,
      reason: "position-reader-unavailable"
    };
  }

  const current = await options.state.positionQuantity(signal.intent.symbol);
  const signedQuantity =
    signal.intent.side === "BUY" ? signal.intent.quantity : signal.intent.quantity.neg();
  const nextPosition = current.plus(signedQuantity).abs();

  if (nextPosition.gt(options.limits.maxAbsolutePosition)) {
    return {
      approved: false,
      reason: "position-above-limit"
    };
  }

  return { approved: true };
}

async function checkOpenOrders(
  signal: Signal,
  options: BasicRiskGateOptions
): Promise<RiskDecision> {
  if (options.limits.maxOpenOrders === undefined) {
    return { approved: true };
  }

  if (!Number.isSafeInteger(options.limits.maxOpenOrders) || options.limits.maxOpenOrders < 0) {
    return {
      approved: false,
      reason: "invalid-open-order-limit"
    };
  }

  if (options.state?.openOrderCount === undefined) {
    return {
      approved: false,
      reason: "open-order-reader-unavailable"
    };
  }

  const openOrders = await options.state.openOrderCount(signal.intent.symbol);

  if (!Number.isSafeInteger(openOrders) || openOrders < 0) {
    return {
      approved: false,
      reason: "invalid-open-order-count"
    };
  }

  if (openOrders >= options.limits.maxOpenOrders) {
    return {
      approved: false,
      reason: "open-orders-at-limit"
    };
  }

  return { approved: true };
}

async function resolvePrice(
  signal: Signal,
  state: BasicRiskGateState | undefined
): Promise<Decimal> {
  if (signal.intent.limitPrice !== undefined) return signal.intent.limitPrice;

  if (state?.marketPrice === undefined) {
    throw new Error("market price is required for market-order notional checks");
  }

  const price = await state.marketPrice(signal.intent.symbol);
  if (!price.isFinite() || price.lte(0)) {
    throw new Error("market price must be positive");
  }

  return price;
}
