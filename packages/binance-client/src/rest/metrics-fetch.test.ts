import { expect, it, vi } from "vitest";
import { BinanceRestClient } from "./client.js";

it("uses the injected fetch across all public REST methods without changing requests", async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const route = new URL(String(url)).pathname;
    return new Response(
      JSON.stringify(
        route === "/api/v3/ticker/bookTicker" || route === "/api/v3/klines"
          ? []
          : route === "/api/v3/time"
            ? { serverTime: 1000 }
            : route === "/api/v3/depth"
              ? { bids: [], asks: [] }
              : { symbols: [] }
      )
    );
  });
  const client = new BinanceRestClient({ environment: "testnet", fetch: request });
  await client.getServerTime();
  await client.getExchangeInfo();
  await client.getBookTickers();
  await client.getDepth({ symbol: "BTCUSDT" });
  await client.getKlines({ symbol: "BTCUSDT", interval: "15m" });
  expect(request).toHaveBeenCalledTimes(5);
  expect(request.mock.calls.map(([url]) => new URL(String(url)).host)).toEqual(
    Array(5).fill("testnet.binance.vision")
  );
});
