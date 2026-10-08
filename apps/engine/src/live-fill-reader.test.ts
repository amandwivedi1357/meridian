import { describe, expect, it, vi } from "vitest";

import { createLiveFillReader, type LiveFillReaderDeps } from "./live-fill-reader.js";

describe("createLiveFillReader", () => {
  it("reads persisted live fills in event-time order", async () => {
    const queries: Parameters<LiveFillReaderDeps["query"]>[0][] = [];
    const query = vi.fn(async (input: Parameters<LiveFillReaderDeps["query"]>[0]) => {
      queries.push(input);
      return {
      rows: [
        {
          symbol: "BTCUSDT",
          side: "BUY",
          quantity: "0.2",
          price: "83000.91",
          fee: "0.0001",
          fee_asset: "BTC",
          event_time_ms: "1700000000100"
        }
      ]
      };
    });
    const reader = createLiveFillReader({ query });

    const fills = await reader.listFills();

    expect(query).toHaveBeenCalledWith({
      text: expect.stringContaining("FROM order_fills"),
      values: []
    });
    const firstQuery = queries[0];
    expect(firstQuery).toBeDefined();
    expect(firstQuery?.text).toContain("ORDER BY event_time_ms ASC");
    expect(fills).toEqual([
      {
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: "0.2",
        price: "83000.91",
        fee: "0.0001",
        feeAsset: "BTC",
        eventTimeMs: 1_700_000_000_100
      }
    ]);
  });

  it("rejects malformed persisted fill rows instead of feeding bad account state", async () => {
    const reader = createLiveFillReader({
      query: vi.fn(async () => ({
        rows: [
          {
            symbol: "BTCUSDT",
            side: "BUY",
            quantity: "-1",
            price: "83000.91",
            fee: "0",
            fee_asset: "USDT",
            event_time_ms: "1700000000100"
          }
        ]
      }))
    });

    await expect(reader.listFills()).rejects.toThrow("Invalid live fill row");
  });
});
