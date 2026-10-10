import { Decimal, projectTestnetAllocation, type TestnetAllocation } from "@meridian/core";
import type { BinanceRestClient, createTestnetTradingClient } from "@meridian/binance-client";
import type { LiveFillReader } from "./live-fill-reader.js";
import type { LiveAccountState } from "./live-account-state.js";

export function createAllocatedAccountState(options: {
  policy: TestnetAllocation;
  publicClient: Pick<BinanceRestClient, "getExchangeInfo">;
  tradingClient: Pick<ReturnType<typeof createTestnetTradingClient>, "getBalances" | "openOrders">;
  fillReader: LiveFillReader;
  assertPolicy: () => Promise<void>;
  backingBaseline: () => Promise<Record<string, string>>;
  listManagedOrders: () => Promise<readonly { clientOrderId: string; symbol: string }[]>;
}): LiveAccountState {
  let view: ReturnType<typeof projectTestnetAllocation> | undefined;
  function available() {
    if (!view) throw new Error("Allocated account has not been refreshed");
    return view;
  }
  return {
    async refresh() {
      view = undefined;
      await options.assertPolicy();
      const info = await options.publicClient.getExchangeInfo();
      const balances = await options.tradingClient.getBalances();
      const openOrders = await options.tradingClient.openOrders();
      view = projectTestnetAllocation({
        policy: options.policy,
        metadata: info.symbols,
        balances,
        openOrders,
        backingBaseline: await options.backingBaseline(),
        managedOrders: await options.listManagedOrders(),
        fills: await options.fillReader.listFills()
      });
    },
    position(symbol) {
      const position = available().positions.get(symbol);
      if (!position) throw new Error("Symbol outside allocated portfolio");
      return position;
    },
    balance(asset) {
      return (
        available().balances.find((balance) => balance.asset === asset)?.free ?? new Decimal(0)
      );
    },
    balanceSnapshot(asset) {
      return (
        available().balances.find((balance) => balance.asset === asset) ?? {
          asset,
          free: new Decimal(0),
          locked: new Decimal(0)
        }
      );
    }
  };
}
