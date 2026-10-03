import { Decimal } from "@meridian/core";
import { describe, expect, it, vi } from "vitest";
import { createPostgresMarketWriter } from "../postgres-market-writer-factory.js";

describe("createPostgresMarketWriter", () => {
  it("wires the Timescale market writer to a postgres-style query client", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const writer = createPostgresMarketWriter({ query });

    await writer.upsertTrades([
      {
        symbol: "BTCUSDT",
        eventId: "12345",
        tradeId: "12345",
        eventTimeMs: 1_700_000_000_000,
        price: new Decimal("100.10"),
        quantity: new Decimal("0.02"),
        isBuyerMaker: true
      }
    ]);

    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO trades"),
      [
        "BTCUSDT",
        "12345",
        "12345",
        new Date(1_700_000_000_000),
        "100.1",
        "0.02",
        true
      ]
    );
  });
});
