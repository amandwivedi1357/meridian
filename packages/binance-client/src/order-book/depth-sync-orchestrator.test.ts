import { Decimal, type BookSnapshot } from "@meridian/core";
import { describe, expect, it, vi } from "vitest";
import type { BinanceDepthStreamPayload } from "../streams/payloads.js";
import { createDepthSyncOrchestrator } from "./depth-sync-orchestrator.js";

function snapshot(lastUpdateId: number, eventTimeMs = 100): {
  readonly book: BookSnapshot;
  readonly lastUpdateId: number;
} {
  return {
    lastUpdateId,
    book: {
      symbol: "BTCUSDT",
      eventTimeMs,
      bids: [{ price: new Decimal("99"), quantity: new Decimal("1") }],
      asks: [{ price: new Decimal("101"), quantity: new Decimal("1") }]
    }
  };
}

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

describe("createDepthSyncOrchestrator", () => {
  it("buffers depth events before the snapshot is loaded and replays them on start", async () => {
    const loadSnapshot = vi.fn(async () => snapshot(100));
    const orchestrator = createDepthSyncOrchestrator({
      symbol: "BTCUSDT",
      loadSnapshot
    });

    await orchestrator.handleDepthEvent(
      depthEvent({
        U: 101,
        u: 101,
        b: [["100", "2"]],
        a: [["101", "0"]]
      })
    );
    await orchestrator.start();

    expect(loadSnapshot).toHaveBeenCalledTimes(1);
    expect(orchestrator.getStatus()).toBe("SYNCED");
    expect(orchestrator.getState()).toEqual({
      status: "SYNCED",
      lastAppliedUpdateId: 101
    });
    expect(orchestrator.snapshot()?.bids.map((bid) => bid.price.toString())).toEqual([
      "100",
      "99"
    ]);
    expect(orchestrator.snapshot()?.asks).toEqual([]);
  });

  it("ignores depth events for other symbols", async () => {
    const orchestrator = createDepthSyncOrchestrator({
      symbol: "BTCUSDT",
      loadSnapshot: async () => snapshot(100)
    });

    const result = await orchestrator.handleDepthEvent(
      depthEvent({
        s: "ETHUSDT",
        U: 101,
        u: 101,
        b: [["100", "2"]]
      })
    );

    expect(result).toBeUndefined();
    await orchestrator.start();
    expect(orchestrator.snapshot()?.bids.map((bid) => bid.price.toString())).toEqual(["99"]);
  });

  it("loads a fresh snapshot when a synced book detects a sequence gap", async () => {
    const loadSnapshot = vi.fn(async () =>
      loadSnapshot.mock.calls.length === 1 ? snapshot(100) : snapshot(103, 300)
    );
    const orchestrator = createDepthSyncOrchestrator({
      symbol: "BTCUSDT",
      loadSnapshot,
      now: () => 500
    });

    await orchestrator.start();
    await orchestrator.handleDepthEvent(depthEvent({ U: 101, u: 101, b: [["100", "2"]] }));
    const result = await orchestrator.handleDepthEvent(depthEvent({ U: 103, u: 103 }));

    expect(result?.applied).toBe(false);
    expect(result?.state.status).toBe("NEEDS_RESYNC");
    expect(loadSnapshot).toHaveBeenCalledTimes(2);
    expect(orchestrator.snapshot()?.eventTimeMs).toBe(300);
    expect(orchestrator.getState()).toEqual({
      status: "WAITING_FOR_FIRST_EVENT",
      lastAppliedUpdateId: 103
    });
    expect(orchestrator.getResyncCount()).toBe(1);
    expect(orchestrator.getUpdateLagMs()).toBe(200);
  });
});
