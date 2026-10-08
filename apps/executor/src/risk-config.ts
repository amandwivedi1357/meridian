import { Decimal } from "@meridian/core";

export interface SymbolRiskLimits {
  minNotional: Decimal;
  maxNotional: Decimal;
  maxQuantity: Decimal;
  maxPosition: Decimal;
  maxExposure: Decimal;
  maxPriceDeviation: Decimal;
}
export function loadRiskConfig(env: NodeJS.ProcessEnv = process.env) {
  function positive(value: unknown, name: string): Decimal {
    if (typeof value !== "string") throw new Error(`Invalid ${name}: decimal string required`);
    const result = new Decimal(value);
    if (!result.isFinite() || result.lte(0)) throw new Error(`Invalid ${name}`);
    return result;
  }
  function integer(name: string, fallback: string) {
    const result = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(result) || result < 1) throw new Error(`Invalid ${name}`);
    return result;
  }
  function object(name: string): Record<string, unknown> {
    const value: unknown = JSON.parse(env[name] ?? "{}");
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error(`Invalid ${name}`);
    return value as Record<string, unknown>;
  }
  const defaults: SymbolRiskLimits = {
    minNotional: positive(env.EXECUTOR_MIN_NOTIONAL ?? "5", "minNotional"),
    maxNotional: positive(env.EXECUTOR_MAX_NOTIONAL ?? "25", "maxNotional"),
    maxQuantity: positive(env.EXECUTOR_MAX_QUANTITY ?? "0.0002", "maxQuantity"),
    maxPosition: positive(env.EXECUTOR_MAX_POSITION ?? "0.001", "maxPosition"),
    maxExposure: positive(env.EXECUTOR_MAX_SYMBOL_EXPOSURE ?? "100", "maxExposure"),
    maxPriceDeviation: positive(env.EXECUTOR_MAX_PRICE_DEVIATION ?? "0.02", "maxPriceDeviation")
  };
  const symbols = new Map<string, SymbolRiskLimits>();
  for (const [symbol, values] of Object.entries(object("EXECUTOR_SYMBOL_RISK_LIMITS"))) {
    if (typeof values !== "object" || values === null || Array.isArray(values))
      throw new Error("Invalid symbol risk limits");
    const limits = { ...defaults };
    for (const [key, value] of Object.entries(values)) {
      if (!(key in defaults)) throw new Error(`Unknown symbol risk limit ${key}`);
      limits[key as keyof SymbolRiskLimits] = positive(value, key);
    }
    symbols.set(symbol, limits);
  }
  for (const limits of [defaults, ...symbols.values()]) {
    if (limits.minNotional.gt(limits.maxNotional) || limits.maxPriceDeviation.gt(1))
      throw new Error("Inconsistent symbol risk limits");
  }
  const strategies = new Map<string, { ordersPerMinute: number; dailyLoss: Decimal }>();
  const ordersPerMinute = integer("EXECUTOR_MAX_ORDERS_PER_MINUTE", "5");
  const dailyLoss = positive(env.EXECUTOR_MAX_DAILY_LOSS ?? "50", "dailyLoss");
  for (const [strategy, values] of Object.entries(object("EXECUTOR_STRATEGY_RISK_LIMITS"))) {
    if (typeof values !== "object" || values === null || Array.isArray(values))
      throw new Error("Invalid strategy risk limits");
    const entry = values as Record<string, unknown>;
    if (Object.keys(entry).some((key) => key !== "ordersPerMinute" && key !== "dailyLoss"))
      throw new Error("Unknown strategy risk limit");
    const rate = entry.ordersPerMinute ?? ordersPerMinute;
    if (typeof rate !== "number" || !Number.isSafeInteger(rate) || rate < 1)
      throw new Error("Invalid strategy order rate");
    strategies.set(strategy, {
      ordersPerMinute: rate,
      dailyLoss: positive(entry.dailyLoss ?? dailyLoss.toFixed(), "dailyLoss")
    });
  }
  const maxDrawdown = positive(env.EXECUTOR_MAX_DRAWDOWN ?? "0.1", "drawdown");
  if (maxDrawdown.gt(1)) throw new Error("Invalid drawdown");
  const quoteAsset = env.EXECUTOR_RISK_QUOTE_ASSET ?? "USDT";
  if (!/^[A-Z0-9]{1,20}$/.test(quoteAsset)) throw new Error("Invalid risk quote asset");
  return {
    quoteAsset,
    symbol: (symbol: string) => symbols.get(symbol) ?? defaults,
    strategy: (strategy: string) => strategies.get(strategy) ?? { ordersPerMinute, dailyLoss },
    globalDailyLoss: dailyLoss,
    maxDrawdown,
    maxGlobalExposure: positive(env.EXECUTOR_MAX_GLOBAL_EXPOSURE ?? "1000", "globalExposure"),
    maxOpenOrders: integer("EXECUTOR_MAX_OPEN_ORDERS", "1"),
    maxDataAgeMs: integer("EXECUTOR_RISK_MAX_DATA_AGE_MS", "5000")
  };
}
export type RiskConfig = ReturnType<typeof loadRiskConfig>;
