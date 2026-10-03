import { Decimal } from "@meridian/core";
import { describe, expect, it } from "vitest";
import { createLocalOrderBook } from "./local-order-book.js";

function level(price: string, quantity: string) {
  return {
    price: new Decimal(price),
    quantity: new Decimal(quantity)
  };
}

describe("createLocalOrderBook", () => {
  it("keeps bids descending, asks ascending, and exposes best levels", () => {
    const book = createLocalOrderBook({
      symbol: "BTCUSDT",
      eventTimeMs: 100,
      bids: [level("99", "1"), level("101", "2"), level("100", "3")],
      asks: [level("103", "1"), level("102", "2"), level("104", "3")]
    });

    const snapshot = book.snapshot();

    expect(snapshot.symbol).toBe("BTCUSDT");
    expect(snapshot.eventTimeMs).toBe(100);
    expect(snapshot.bids.map((bid) => bid.price.toString())).toEqual(["101", "100", "99"]);
    expect(snapshot.asks.map((ask) => ask.price.toString())).toEqual(["102", "103", "104"]);
    expect(book.bestBid()?.price.toString()).toBe("101");
    expect(book.bestAsk()?.price.toString()).toBe("102");
  });

  it("applies updates, removes zero-quantity levels, and advances event time", () => {
    const book = createLocalOrderBook({
      symbol: "ETHUSDT",
      eventTimeMs: 100,
      bids: [level("99", "1"), level("98", "2")],
      asks: [level("101", "1"), level("102", "2")]
    });

    book.apply({
      eventTimeMs: 200,
      bids: [level("99", "0"), level("100", "4")],
      asks: [level("101", "3"), level("102", "0")]
    });

    const snapshot = book.snapshot();

    expect(snapshot.eventTimeMs).toBe(200);
    expect(snapshot.bids.map((bid) => [bid.price.toString(), bid.quantity.toString()])).toEqual([
      ["100", "4"],
      ["98", "2"]
    ]);
    expect(snapshot.asks.map((ask) => [ask.price.toString(), ask.quantity.toString()])).toEqual([
      ["101", "3"]
    ]);
    expect(book.bestBid()?.price.toString()).toBe("100");
    expect(book.bestAsk()?.price.toString()).toBe("101");
  });
});
