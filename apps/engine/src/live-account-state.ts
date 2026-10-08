import {
  Decimal,
  type BalanceSnapshot,
  type Position,
  type SymbolCode
} from "@meridian/core";

export interface LiveFillRow {
  readonly symbol: SymbolCode;
  readonly side: "BUY" | "SELL";
  readonly quantity: string;
  readonly price: string;
  readonly fee: string;
  readonly feeAsset: string;
  readonly eventTimeMs: number;
}

export interface LiveAccountStateDeps {
  readonly listFills: () => Promise<readonly LiveFillRow[]>;
  readonly getBalances: () => Promise<readonly BalanceSnapshot[]>;
}

export interface LiveAccountState {
  readonly refresh: () => Promise<void>;
  readonly position: (symbol: SymbolCode) => Position;
  readonly balance: (asset: string) => Decimal;
  readonly balanceSnapshot: (asset: string) => BalanceSnapshot;
}

export function createLiveAccountState(deps: LiveAccountStateDeps): LiveAccountState {
  let refreshed = false;
  let positions = new Map<SymbolCode, Position>();
  let balances = new Map<string, BalanceSnapshot>();

  return {
    async refresh() {
      const [fills, accountBalances] = await Promise.all([
        deps.listFills(),
        deps.getBalances()
      ]);

      positions = calculatePositions(fills);
      balances = new Map(accountBalances.map((snapshot) => [snapshot.asset, snapshot]));
      refreshed = true;
    },

    position(symbol) {
      ensureRefreshed(refreshed);

      return (
        positions.get(symbol) ?? {
          symbol,
          quantity: new Decimal(0),
          avgEntry: new Decimal(0),
          realizedPnl: new Decimal(0)
        }
      );
    },

    balance(asset) {
      ensureRefreshed(refreshed);

      return balances.get(asset)?.free ?? new Decimal(0);
    },

    balanceSnapshot(asset) {
      ensureRefreshed(refreshed);

      return (
        balances.get(asset) ?? {
          asset,
          free: new Decimal(0),
          locked: new Decimal(0)
        }
      );
    }
  };
}

function ensureRefreshed(refreshed: boolean): void {
  if (!refreshed) {
    throw new Error("Live account state has not been refreshed");
  }
}

function calculatePositions(fills: readonly LiveFillRow[]): Map<SymbolCode, Position> {
  const positions = new Map<SymbolCode, Position>();

  for (const fill of [...fills].sort((a, b) => a.eventTimeMs - b.eventTimeMs)) {
    const current =
      positions.get(fill.symbol) ?? {
        symbol: fill.symbol,
        quantity: new Decimal(0),
        avgEntry: new Decimal(0),
        realizedPnl: new Decimal(0)
      };

    positions.set(fill.symbol, applyFill(current, fill));
  }

  return positions;
}

function applyFill(position: Position, fill: LiveFillRow): Position {
  const quantity = new Decimal(fill.quantity);
  const price = new Decimal(fill.price);
  const baseAsset = inferBaseAsset(fill.symbol);
  const baseFee = fill.feeAsset === baseAsset ? new Decimal(fill.fee) : new Decimal(0);

  if (fill.side === "BUY") {
    const netQuantity = quantity.minus(baseFee);
    const nextQuantity = position.quantity.plus(netQuantity);
    const nextAvgEntry = nextQuantity.isZero()
      ? new Decimal(0)
      : position.quantity
          .times(position.avgEntry)
          .plus(netQuantity.times(price))
          .div(nextQuantity);

    return {
      ...position,
      quantity: nextQuantity,
      avgEntry: nextAvgEntry
    };
  }

  const sellQuantity = Decimal.min(quantity, position.quantity);
  const realizedPnl = price.minus(position.avgEntry).times(sellQuantity);
  const nextQuantity = position.quantity.minus(sellQuantity);

  return {
    ...position,
    quantity: nextQuantity,
    avgEntry: nextQuantity.isZero() ? new Decimal(0) : position.avgEntry,
    realizedPnl: position.realizedPnl.plus(realizedPnl)
  };
}

function inferBaseAsset(symbol: string): string {
  for (const quote of ["USDT", "USDC", "FDUSD", "BUSD", "BTC", "ETH", "BNB"]) {
    if (symbol.endsWith(quote) && symbol.length > quote.length) {
      return symbol.slice(0, -quote.length);
    }
  }

  return symbol;
}