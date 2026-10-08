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
});
