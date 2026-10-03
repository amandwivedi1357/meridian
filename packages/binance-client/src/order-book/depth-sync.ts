import { Decimal, type BookLevel, type BookSnapshot } from "@meridian/core";
import type { BinanceDepthStreamPayload } from "../streams/payloads.js";
import { createLocalOrderBook } from "./local-order-book.js";

export type DepthSyncStatus = "WAITING_FOR_FIRST_EVENT" | "SYNCED" | "NEEDS_RESYNC";

export interface DepthSyncSnapshot {
  readonly book: BookSnapshot;
  readonly lastUpdateId: number;
}

export interface DepthSyncState {
  readonly status: DepthSyncStatus;
  readonly lastAppliedUpdateId: number;
}

export interface DepthSyncResult {
  readonly applied: boolean;
  readonly state: DepthSyncState;
}

export interface LocalDepthSync {
  applyDepthEvent(event: BinanceDepthStreamPayload): DepthSyncResult;
  snapshot(): BookSnapshot;
  getState(): DepthSyncState;
}

export function createLocalDepthSync(snapshot: DepthSyncSnapshot): LocalDepthSync {
  const book = createLocalOrderBook({
    symbol: snapshot.book.symbol,
    eventTimeMs: snapshot.book.eventTimeMs,
    bids: snapshot.book.bids,
    asks: snapshot.book.asks
  });

  let state: DepthSyncState = {
    status: "WAITING_FOR_FIRST_EVENT",
    lastAppliedUpdateId: snapshot.lastUpdateId
  };

  function applyDepthEvent(event: BinanceDepthStreamPayload): DepthSyncResult {
    if (state.status === "NEEDS_RESYNC") {
      return { applied: false, state };
    }

    const expectedUpdateId = state.lastAppliedUpdateId + 1;

    if (event.u < expectedUpdateId) {
      return { applied: false, state };
    }

    if (event.U > expectedUpdateId) {
      state = {
        status: "NEEDS_RESYNC",
        lastAppliedUpdateId: state.lastAppliedUpdateId
      };

      return { applied: false, state };
    }

    book.apply({
      eventTimeMs: event.E,
      bids: toBookLevels(event.b),
      asks: toBookLevels(event.a)
    });

    state = {
      status: "SYNCED",
      lastAppliedUpdateId: event.u
    };

    return { applied: true, state };
  }

  return {
    applyDepthEvent,
    snapshot: () => book.snapshot(),
    getState: () => state
  };
}

function toBookLevels(
  levels: readonly (readonly [price: string, quantity: string])[]
): BookLevel[] {
  return levels.map(([price, quantity]) => ({
    price: new Decimal(price),
    quantity: new Decimal(quantity)
  }));
}
