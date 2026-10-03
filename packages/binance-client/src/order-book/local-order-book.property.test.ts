import { Decimal } from "@meridian/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createLocalOrderBook, type BookUpdate } from "./local-order-book.js";

function level(price: number, quantity: number) {
  return {
    price: new Decimal(price),
    quantity: new Decimal(quantity)
  };
}

function snapshotSide(
  side: Map<string, string>,
  sortDirection: "asc" | "desc"
): readonly (readonly [string, string])[] {
  return [...side.entries()].sort(([leftPrice], [rightPrice]) =>
    sortDirection === "asc"
      ? new Decimal(leftPrice).comparedTo(rightPrice)
      : new Decimal(rightPrice).comparedTo(leftPrice)
  );
}

describe("createLocalOrderBook property tests", () => {
  it("matches a naive reference model for arbitrary update sequences", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            eventTimeMs: fc.integer({ min: 1, max: 1_000_000 }),
            bids: fc.array(
              fc.record({
                price: fc.integer({ min: 1, max: 200 }),
                quantity: fc.integer({ min: 0, max: 20 })
              }),
              { maxLength: 10 }
            ),
            asks: fc.array(
              fc.record({
                price: fc.integer({ min: 201, max: 400 }),
                quantity: fc.integer({ min: 0, max: 20 })
              }),
              { maxLength: 10 }
            )
          }),
          { maxLength: 50 }
        ),
        (updates) => {
          const book = createLocalOrderBook({
            symbol: "BTCUSDT",
            eventTimeMs: 0,
            bids: [level(100, 1)],
            asks: [level(201, 1)]
          });
          const referenceBids = new Map<string, string>([["100", "1"]]);
          const referenceAsks = new Map<string, string>([["201", "1"]]);

          for (const update of updates) {
            const bookUpdate: BookUpdate = {
              eventTimeMs: update.eventTimeMs,
              bids: update.bids.map(({ price, quantity }) => level(price, quantity)),
              asks: update.asks.map(({ price, quantity }) => level(price, quantity))
            };

            book.apply(bookUpdate);

            for (const bid of update.bids) {
              if (bid.quantity === 0) {
                referenceBids.delete(String(bid.price));
              } else {
                referenceBids.set(String(bid.price), String(bid.quantity));
              }
            }

            for (const ask of update.asks) {
              if (ask.quantity === 0) {
                referenceAsks.delete(String(ask.price));
              } else {
                referenceAsks.set(String(ask.price), String(ask.quantity));
              }
            }
          }

          const snapshot = book.snapshot();

          expect(snapshot.bids.map((bid) => [bid.price.toString(), bid.quantity.toString()]))
            .toEqual(snapshotSide(referenceBids, "desc"));
          expect(snapshot.asks.map((ask) => [ask.price.toString(), ask.quantity.toString()]))
            .toEqual(snapshotSide(referenceAsks, "asc"));
        }
      ),
      { numRuns: 100 }
    );
  });
});
