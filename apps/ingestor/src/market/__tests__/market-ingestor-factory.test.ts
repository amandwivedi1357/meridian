import { decodeMarketEvent } from "@meridian/proto";
import { describe, expect, it, vi } from "vitest";
import { createMarketIngestor } from "../market-ingestor-factory.js";
import type { MarketEventPublisherDeps } from "../market-publisher.js";

describe("createMarketIngestor", () => {
  it("wires normalization, shared encoding, Redis publishing, and batch persistence", async () => {
    let publishedFields: Parameters<MarketEventPublisherDeps["xadd"]>[2] | undefined;
    const xadd = vi.fn(async (...args: Parameters<MarketEventPublisherDeps["xadd"]>) => {
      publishedFields = args[2];
      return "1700000000000-0";
    });
    const upsertTrades = vi.fn(async () => undefined);
    const upsertKlines = vi.fn(async () => undefined);
    const ingestor = createMarketIngestor({
      xadd,
      upsertTrades,
      upsertKlines
    });

    const result = await ingestor.ingest({
      e: "trade",
      E: 1_700_000_000_000,
      s: "BTCUSDT",
      t: 12345,
      p: "100.10",
      q: "0.0200",
      b: 1,
      a: 2,
      T: 1_700_000_000_001,
      m: true,
      M: true
    });

    expect(xadd).toHaveBeenCalledOnce();
    expect(upsertTrades).toHaveBeenCalledOnce();
    expect(upsertKlines).not.toHaveBeenCalled();
    expect(result.publishResult).toEqual({
      stream: "market.trade.BTCUSDT",
      id: "1700000000000-0"
    });

    expect(publishedFields?.kind).toBe("trade");
    expect(publishedFields?.schemaVersion).toBe("meridian.v1");

    const decoded = decodeMarketEvent(publishedFields?.payload ?? Buffer.from([]));
    expect(decoded.kind).toBe("trade");

    if (decoded.kind !== "trade") {
      throw new Error("expected trade event");
    }

    expect(decoded.trade.price.toString()).toBe("100.1");
    expect(upsertTrades).toHaveBeenCalledWith([
      expect.objectContaining({
        symbol: "BTCUSDT",
        eventId: "12345",
        tradeId: "12345"
      })
    ]);
  });
});
