import { Decimal } from "@meridian/core";
import { describe, expect, it } from "vitest";
import type { BinanceDepthStreamPayload } from "../streams/payloads.js";
import { createLocalDepthSync } from "./depth-sync.js";

function depthEvent(overrides: Partial<BinanceDepthStreamPayload>): BinanceDepthStreamPayload {
  return {
    e: "depthUpdate",
    E: 200,
    s: "BTCUSDT",
    U: 101,
    u: 101,
    b: [],
    a: [],
    ...overrides
  };
}

function createSync() {
  return createLocalDepthSync({
    lastUpdateId: 100,
    book: {
      symbol: "BTCUSDT",
      eventTimeMs: 100,
      bids: [{ price: new Decimal("99"), quantity: new Decimal("1") }],
      asks: [{ price: new Decimal("101"), quantity: new Decimal("1") }]
    }
  });
}

describe("createLocalDepthSync", () => {
  it("applies the first event when it bridges the snapshot update id", () => {
    const sync = createSync();

    const result = sync.applyDepthEvent(
      depthEvent({
        U: 99,
        u: 101,
        b: [["100", "2"]],
        a: [["101", "0"]]
      })
    );

    expect(result.applied).toBe(true);
    expect(result.state).toEqual({
      status: "SYNCED",
      lastAppliedUpdateId: 101
    });
    expect(sync.snapshot().eventTimeMs).toBe(200);
    expect(sync.snapshot().bids.map((bid) => [bid.price.toString(), bid.quantity.toString()]))
      .toEqual([
        ["100", "2"],
        ["99", "1"]
      ]);
    expect(sync.snapshot().asks).toEqual([]);
  });

  it("ignores stale events that end before the next expected update id", () => {
    const sync = createSync();

    const result = sync.applyDepthEvent(depthEvent({ U: 90, u: 100, b: [["100", "2"]] }));

    expect(result.applied).toBe(false);
    expect(result.state).toEqual({
      status: "WAITING_FOR_FIRST_EVENT",
      lastAppliedUpdateId: 100
    });
    expect(sync.snapshot().bids.map((bid) => bid.price.toString())).toEqual(["99"]);
  });

  it("marks the book as needing resync when a sequence gap is detected", () => {
    const sync = createSync();

    const result = sync.applyDepthEvent(depthEvent({ U: 102, u: 103, b: [["100", "2"]] }));

    expect(result.applied).toBe(false);
    expect(result.state).toEqual({
      status: "NEEDS_RESYNC",
      lastAppliedUpdateId: 100
    });
    expect(sync.getState()).toEqual(result.state);
    expect(sync.snapshot().bids.map((bid) => bid.price.toString())).toEqual(["99"]);
  });

  it("requires continuous events after the book is synced", () => {
    const sync = createSync();

    sync.applyDepthEvent(depthEvent({ U: 101, u: 101, b: [["100", "2"]] }));

    const result = sync.applyDepthEvent(depthEvent({ U: 103, u: 103, b: [["102", "4"]] }));

    expect(result.applied).toBe(false);
    expect(result.state.status).toBe("NEEDS_RESYNC");
    expect(sync.snapshot().bids.map((bid) => bid.price.toString())).toEqual(["100", "99"]);
  });
});
