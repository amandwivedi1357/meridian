import { describe, expect, it, vi } from "vitest";

import { createBinanceAccountClient } from "./account-client.js";
import { createHmacSigner } from "./signing.js";

function setup(response: unknown = { balances: [] }) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(JSON.stringify(response), {
      status: 200
    })
  );
  const acquire = vi.fn(async () => undefined);
  const client = createBinanceAccountClient({
    apiKey: "test-only-api-key",
    signer: createHmacSigner("test-only-secret"),
    now: () => 2_000,
    fetch,
    rateLimiter: { acquire }
  });

  return { client, fetch, acquire };
}

describe("createBinanceAccountClient", () => {
  it("reads account balances through the signed Testnet account endpoint", async () => {
    const { client, fetch, acquire } = setup({
      balances: [
        { asset: "BTC", free: "0.001", locked: "0.0002" },
        { asset: "USDT", free: "1000.25", locked: "10" }
      ]
    });

    const balances = await client.getBalances();

    expect(acquire).toHaveBeenCalledWith(20);
    expect(String(fetch.mock.calls[0]?.[0])).toContain(
      "https://testnet.binance.vision/api/v3/account?"
    );
    expect(balances.map((balance) => ({
      asset: balance.asset,
      free: balance.free.toString(),
      locked: balance.locked.toString()
    }))).toEqual([
      { asset: "BTC", free: "0.001", locked: "0.0002" },
      { asset: "USDT", free: "1000.25", locked: "10" }
    ]);
  });

  it("rejects malformed account balance responses", async () => {
    const { client } = setup({
      balances: [{ asset: "BTC", free: "-1", locked: "0" }]
    });

    await expect(client.getBalances()).rejects.toThrow("Invalid account response");
  });

  it("reads account trades for missed-fill catch-up through the signed Testnet endpoint", async () => {
    const { client, fetch, acquire } = setup([
      {
        symbol: "BTCUSDT",
        id: 789,
        orderId: 123,
        orderListId: -1,
        price: "83000.91",
        qty: "0.0002",
        quoteQty: "16.600182",
        commission: "0.000001",
        commissionAsset: "BTC",
        time: 1_704_067_201_000,
        isBuyer: true,
        isMaker: false,
        isBestMatch: true
      }
    ]);

    const trades = await client.getAccountTrades({
      symbol: "BTCUSDT",
      orderId: "123",
      startTime: 1_704_067_000_000,
      endTime: 1_704_067_300_000,
      limit: 100
    });

    expect(acquire).toHaveBeenCalledWith(20);
    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/api/v3/myTrades");
    expect(url.searchParams.get("symbol")).toBe("BTCUSDT");
    expect(url.searchParams.get("orderId")).toBe("123");
    expect(url.searchParams.get("startTime")).toBe("1704067000000");
    expect(url.searchParams.get("endTime")).toBe("1704067300000");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(trades.map((trade) => ({
      symbol: trade.symbol,
      tradeId: trade.tradeId,
      orderId: trade.orderId,
      price: trade.price.toString(),
      quantity: trade.quantity.toString(),
      quoteQuantity: trade.quoteQuantity.toString(),
      commission: trade.commission.toString(),
      commissionAsset: trade.commissionAsset,
      eventTimeMs: trade.eventTimeMs,
      side: trade.side
    }))).toEqual([
      {
        symbol: "BTCUSDT",
        tradeId: "789",
        orderId: "123",
        price: "83000.91",
        quantity: "0.0002",
        quoteQuantity: "16.600182",
        commission: "0.000001",
        commissionAsset: "BTC",
        eventTimeMs: 1_704_067_201_000,
        side: "BUY"
      }
    ]);
  });

  it("omits undefined account-trade query parameters exactly", async () => {
    const { client, fetch } = setup([]);

    await client.getAccountTrades({ symbol: "BTCUSDT" });

    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.searchParams.has("orderId")).toBe(false);
    expect(url.searchParams.has("startTime")).toBe(false);
    expect(url.searchParams.has("endTime")).toBe(false);
    expect(url.searchParams.has("limit")).toBe(false);
  });

  it("rejects malformed account trade responses", async () => {
    const { client } = setup([{ id: 1, symbol: "BTCUSDT", qty: "-1" }]);

    await expect(client.getAccountTrades({ symbol: "BTCUSDT" })).rejects.toThrow(
      "Invalid account trades response"
    );
  });
});
