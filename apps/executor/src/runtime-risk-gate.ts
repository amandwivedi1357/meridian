import { Decimal, type Signal } from "@meridian/core";
import { createBasicRiskGate } from "./basic-risk-gate.js";

export function createRuntimeRiskGate(options: {
  assertReady: () => Promise<void>;
  getBaseAsset: (symbol: string) => Promise<string>;
  getBalances: () => Promise<readonly { asset: string; free: Decimal; locked: Decimal }[]>;
  getMarketPrice: (symbol: string) => Promise<Decimal>;
  getOpenOrderCount: (symbol: string) => Promise<number>;
  env?: NodeJS.ProcessEnv;
}) {
  const env = options.env ?? process.env;
  function limit(name: string, fallback: string): Decimal {
    const result = new Decimal(env[name] ?? fallback);
    if (!result.isFinite() || result.lte(0)) throw new Error(`Invalid ${name}`);
    return result;
  }
  const maxOpenOrders = Number(env.EXECUTOR_MAX_OPEN_ORDERS ?? "1");
  if (!Number.isSafeInteger(maxOpenOrders) || maxOpenOrders < 1)
    throw new Error("Invalid EXECUTOR_MAX_OPEN_ORDERS");
  const gate = createBasicRiskGate({
    limits: {
      minNotional: limit("EXECUTOR_MIN_NOTIONAL", "5"),
      maxNotional: limit("EXECUTOR_MAX_NOTIONAL", "25"),
      maxQuantity: limit("EXECUTOR_MAX_QUANTITY", "0.0002"),
      maxAbsolutePosition: limit("EXECUTOR_MAX_POSITION", "0.001"),
      maxOpenOrders
    },
    state: {
      marketPrice: options.getMarketPrice,
      openOrderCount: options.getOpenOrderCount,
      async positionQuantity(symbol) {
        const baseAsset = await options.getBaseAsset(symbol);
        const balance = (await options.getBalances()).find((entry) => entry.asset === baseAsset);
        if (balance === undefined) throw new Error("Position balance unavailable");
        return balance.free.plus(balance.locked);
      }
    }
  });
  return {
    async evaluate(signal: Signal) {
      await options.assertReady();
      return gate.evaluate(signal);
    }
  };
}
