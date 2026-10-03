import { Decimal, type BookLevel, type BookSnapshot } from "@meridian/core";

export interface BookUpdate {
  readonly eventTimeMs: number;
  readonly bids: readonly BookLevel[];
  readonly asks: readonly BookLevel[];
}
export interface LocalOrderBookOptions{
    readonly symbol:string;
    readonly eventTimeMs:number;
    readonly bids : readonly BookLevel[]
     readonly asks: readonly BookLevel[];
}

export interface LocalOrderBook{
    apply(update:BookUpdate):void;
    snapshot():BookSnapshot;
    bestBid(): BookLevel | undefined;
  bestAsk(): BookLevel | undefined;
}


export function createLocalOrderBook(options:LocalOrderBookOptions):LocalOrderBook{
    const bids = new Map<string, Decimal>();
    const asks = new Map<string, Decimal>();

    let eventTimeMs = options.eventTimeMs;

    for(const level of options.bids){
        bids.set(level.price.toString(),level.quantity);
    }
     for (const level of options.asks) {
    asks.set(level.price.toString(), level.quantity);
  }

  function applySide(
    side: Map<string, Decimal>,
    levels: readonly BookLevel[]
  ): void {
    for (const level of levels) {
      const priceKey = level.price.toString();

      if (level.quantity.isZero()) {
        side.delete(priceKey);
        continue;
      }

      side.set(priceKey, level.quantity);
    }
  }
  function levelsFromMap(
    side: Map<string, Decimal>,
    sortDirection: "asc" | "desc"
  ): BookLevel[] {
    return [...side.entries()]
      .map(([price, quantity]) => ({
        price: new Decimal(price),
        quantity
      }))
      .sort((a, b) =>
        sortDirection === "asc"
          ? a.price.comparedTo(b.price)
          : b.price.comparedTo(a.price)
      );
  }

  function snapshot(): BookSnapshot {
    return {
      symbol: options.symbol,
      eventTimeMs,
      bids: levelsFromMap(bids, "desc"),
      asks: levelsFromMap(asks, "asc")
    };
  }

  return {
    apply(update) {
      applySide(bids, update.bids);
      applySide(asks, update.asks);
      eventTimeMs = update.eventTimeMs;
    },
    snapshot,
    bestBid() {
      return snapshot().bids[0];
    },
    bestAsk() {
      return snapshot().asks[0];
    }
  };
}