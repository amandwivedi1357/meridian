import { afterEach, describe, expect, it, vi } from "vitest";
import { BinanceRestClient } from "./client.js";
afterEach(() => vi.unstubAllGlobals());
describe("batch public wallet quotes", () => {
  it("uses the configured Testnet origin, weight and bounded request", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify([{ symbol: "BTCUSDT", bidPrice: "99", askPrice: "101" }]))
      );
    vi.stubGlobal("fetch", fetch);
    const limiter = { acquire: vi.fn().mockResolvedValue(undefined) };
    const client = new BinanceRestClient({ environment: "testnet", rateLimiter: limiter as never });
    expect((await client.getBookTickers())[0]?.bidPrice).toBe("99");
    expect(limiter.acquire).toHaveBeenCalledWith(4);
    expect(fetch.mock.calls[0]?.[0].toString()).toBe(
      "https://testnet.binance.vision/api/v3/ticker/bookTicker"
    );
    expect(fetch.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
  });
  it("rejects malformed numeric quotes", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify([{ symbol: "BTCUSDT", bidPrice: "NaN", askPrice: "101" }]))
        )
    );
    await expect(new BinanceRestClient().getBookTickers()).rejects.toThrow();
  });
});
