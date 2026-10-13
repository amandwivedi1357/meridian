import { randomUUID } from "node:crypto";
import { marketDemandKey, marketDemandScript } from "@meridian/config";

export interface MarketDemandLease {
  refresh(): Promise<void>;
  release(): Promise<void>;
}
export function createMarketDemand(
  command: (args: readonly string[]) => Promise<unknown>,
  validate: (symbol: string) => Promise<boolean>
) {
  return async (symbol: string): Promise<MarketDemandLease> => {
    if (!/^[A-Z0-9]{3,30}$/.test(symbol) || !(await validate(symbol)))
      throw new Error("unsupported_market_symbol");
    if (symbol === "BTCUSDT") return { refresh: async () => {}, release: async () => {} };
    const member = `${randomUUID()}|${symbol}`;
    const refresh = async () => {
      if ((await command(["EVAL", marketDemandScript, "1", marketDemandKey, member, symbol])) !== 1)
        throw new Error("market_feed_capacity");
    };
    await refresh();
    return {
      refresh,
      release: async () => {
        await command(["ZREM", marketDemandKey, member]);
      }
    };
  };
}
