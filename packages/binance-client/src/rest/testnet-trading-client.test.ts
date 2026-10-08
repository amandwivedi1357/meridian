import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createEd25519Signer, createHmacSigner } from "./signing.js";
import {
  createTestnetTradingClient,
  type TestnetTradingClientOptions
} from "./testnet-trading-client.js";
import { EventEmitter } from "node:events";

const signer = createHmacSigner("test-only-secret");
const lookup = { symbol: "BTCUSDT", clientOrderId: "meridian-test-1" };
const order = {
  symbol: "BTCUSDT",
  orderId: 123,
  orderListId: -1,
  clientOrderId: lookup.clientOrderId,
  price: "0",
  origQty: "0.00100000",
  executedQty: "0",
  cummulativeQuoteQty: "0",
  status: "NEW",
  timeInForce: "GTC",
  type: "MARKET",
  side: "BUY"
};

function setup(overrides: Partial<TestnetTradingClientOptions> = {}) {
  let localNow = 1_000;
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input) => {
    if (String(input).endsWith("/time")) {
      localNow += 200;
      return new Response(JSON.stringify({ serverTime: 2_100 }));
    }
    return new Response(JSON.stringify(order));
  });
  const acquire = vi.fn<(weight: number) => Promise<void>>(async () => {});
  const client = createTestnetTradingClient({
    apiKey: "test-only-api-key",
    signer,
    fetch,
    nowMs: () => localNow,
    rateLimiter: { acquire },
    ...overrides
  });
  return {
    client,
    fetch,
    acquire,
    setNow: (value: number) => {
      localNow = value;
    }
  };
}

describe("createTestnetTradingClient", () => {
  it("refreshes stale time on opt-in signed operations without resending mutations", async () => {
    const { client, fetch, setNow } = setup({ autoSynchronizeTime: true });
    await client.queryOrder(lookup);
    setNow(61_201);
    await client.placeOrder({ ...lookup, side: "BUY", type: "MARKET", quantity: "0.001" });
    const urls = fetch.mock.calls.map((call) => String(call[0]));
    expect(urls.filter((url) => url.endsWith("/time"))).toHaveLength(2);
    expect(fetch.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
    client.close();
  });

  it("does not send signed requests when automatic clock refresh fails", async () => {
    const { client, fetch } = setup({ autoSynchronizeTime: true });
    fetch.mockRejectedValueOnce(new Error("offline"));
    await expect(client.queryOrder(lookup)).rejects.toThrow("synchronization failed");
    expect(fetch).toHaveBeenCalledOnce();
    client.close();
  });
  it("starts the composed user-data stream with fresh time and shared weights", async () => {
    vi.useFakeTimers();
    class FakeSocket extends EventEmitter {
      readonly send = vi.fn<(message: string) => void>();
      readonly ping = vi.fn();
      readonly terminate = vi.fn();
    }
    const socket = new FakeSocket();
    const { client, fetch, acquire } = setup({ userData: { createWebSocket: () => socket } });
    try {
      client.userData.start();
      await vi.advanceTimersByTimeAsync(0);
      socket.emit("open");
      await vi.advanceTimersByTimeAsync(0);
      const request = JSON.parse(socket.send.mock.calls[0]![0]) as {
        id: string;
        params: { timestamp: number };
      };
      expect(request.params.timestamp).toBe(2_200);
      socket.emit(
        "message",
        JSON.stringify({ id: request.id, status: 200, result: { subscriptionId: 0 } })
      );
      expect(client.userData.getState()).toBe("OPEN");
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(acquire.mock.calls).toEqual([[1], [2], [2]]);
      client.close();
      expect(client.userData.getState()).toBe("CLOSED");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      client.close();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
  it("does not issue requests when constructed", () => {
    const { fetch, acquire } = setup();
    expect(fetch).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
  });

  it("refuses orders until time synchronization succeeds", async () => {
    const { client, fetch } = setup();
    await expect(
      client.placeOrder({ ...lookup, side: "BUY", type: "MARKET", quantity: "0.001" })
    ).rejects.toThrow("not synchronized");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches unsigned Testnet time, then uses the offset for a signed query", async () => {
    const { client, fetch, acquire } = setup();
    await client.synchronizeTime();
    const [input, init] = fetch.mock.calls[0]!;
    expect(String(input)).toBe("https://testnet.binance.vision/api/v3/time");
    expect(new Headers(init?.headers).has("X-MBX-APIKEY")).toBe(false);
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    await client.queryOrder(lookup);
    const url = new URL(String(fetch.mock.calls[1]?.[0]));
    expect(url.searchParams.get("timestamp")).toBe("2200");
    expect(url.searchParams.get("recvWindow")).toBe("5000");
    const payload = url.search.slice(1, url.search.lastIndexOf("&signature="));
    expect(url.searchParams.get("signature")).toBe(signer.sign(payload));
    expect(acquire.mock.calls).toEqual([[1], [4]]);
  });

  it("wires placement, cancellation and open-order listing through the same clock", async () => {
    const { client, fetch } = setup();
    await client.synchronizeTime();
    await client.placeOrder({ ...lookup, side: "BUY", type: "MARKET", quantity: "0.001" });
    fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ...order, status: "CANCELED", origClientOrderId: lookup.clientOrderId })
      )
    );
    await client.cancelOrder(lookup);
    fetch.mockResolvedValueOnce(new Response("[]"));
    await expect(client.openOrders({ symbol: "BTCUSDT" })).resolves.toEqual([]);
    expect(fetch.mock.calls.map((call) => call[1]?.method)).toEqual([
      "GET",
      "POST",
      "DELETE",
      "GET"
    ]);
  });

  it("wires account balance snapshots through the same synchronized clock", async () => {
    const { client, fetch, acquire } = setup();
    await client.synchronizeTime();
    fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          balances: [{ asset: "USDT", free: "1000.25", locked: "10" }]
        })
      )
    );

    const balances = await client.getBalances();

    expect(balances[0]?.asset).toBe("USDT");
    expect(balances[0]?.free.toString()).toBe("1000.25");
    expect(new URL(String(fetch.mock.calls[1]?.[0])).pathname).toBe("/api/v3/account");
    expect(acquire.mock.calls).toEqual([[1], [20]]);
  });

  it("deduplicates concurrent synchronization and weight acquisition", async () => {
    const { client, fetch, acquire } = setup();
    await Promise.all([
      client.synchronizeTime(),
      client.synchronizeTime(),
      client.synchronizeTime()
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it("can refresh expired time explicitly", async () => {
    const { client, fetch, setNow } = setup();
    await client.synchronizeTime();
    setNow(61_200);
    await expect(client.queryOrder(lookup)).rejects.toThrow("resynchronization");
    expect(fetch).toHaveBeenCalledTimes(1);
    await client.synchronizeTime();
    await expect(client.queryOrder(lookup)).resolves.toMatchObject({ orderId: 123 });
  });

  it("fails closed after a synchronization error and permits a later explicit retry", async () => {
    const { client, fetch } = setup();
    await client.synchronizeTime();
    fetch.mockRejectedValueOnce(new Error("sensitive upstream details"));
    await expect(client.synchronizeTime()).rejects.toThrow(
      "Testnet server-time synchronization failed"
    );
    await expect(client.queryOrder(lookup)).rejects.toThrow("not synchronized");
    expect(fetch).toHaveBeenCalledTimes(2);
    await client.synchronizeTime();
    await expect(client.queryOrder(lookup)).resolves.toMatchObject({ orderId: 123 });
  });

  it.each([
    {},
    { serverTime: "2100" },
    { serverTime: -1 },
    { serverTime: 1.5 },
    { serverTime: null },
    { serverTime: Number.MAX_SAFE_INTEGER + 1 }
  ])("rejects malformed time responses %j before allowing orders", async (response) => {
    const { client, fetch } = setup();
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(response)));
    await expect(client.synchronizeTime()).rejects.toThrow("synchronization failed");
    await expect(client.queryOrder(lookup)).rejects.toThrow("not synchronized");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not automatically retry HTTP errors from the time endpoint", async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValueOnce(new Response("{}", { status: 503 }));
    await expect(client.synchronizeTime()).rejects.toThrow("synchronization failed");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("measures RTT only after limiter waiting", async () => {
    let localNow = 1_000;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('{"serverTime":10000}'));
    const client = createTestnetTradingClient({
      apiKey: "test-only-api-key",
      signer,
      nowMs: () => localNow,
      fetch,
      rateLimiter: {
        acquire: async () => {
          localNow += 5_000;
        }
      }
    });
    await expect(client.synchronizeTime()).resolves.toBeUndefined();
  });

  it("does not send when the synchronization limiter rejects", async () => {
    const { client, fetch, acquire } = setup();
    acquire.mockRejectedValueOnce(new Error("Limiter unavailable"));
    await expect(client.synchronizeTime()).rejects.toThrow("Limiter unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("supports the existing Ed25519 signer end to end", async () => {
    const keys = generateKeyPairSync("ed25519");
    const pem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const { client, fetch } = setup({ signer: createEd25519Signer(pem) });
    await client.synchronizeTime();
    await client.queryOrder(lookup);
    const url = new URL(String(fetch.mock.calls[1]?.[0]));
    const payload = url.search.slice(1, url.search.lastIndexOf("&signature="));
    const signature = Buffer.from(url.searchParams.get("signature")!, "base64");
    expect(verify(null, Buffer.from(payload), keys.publicKey, signature)).toBe(true);
  });

  it("refuses production at construction", () => {
    expect(() => setup({ environment: "production" })).toThrow("Testnet only");
  });

  it("aborts time fetch on timeout and clears the timer", async () => {
    vi.useFakeTimers();
    try {
      const { client, fetch } = setup({ timeoutMs: 50 });
      fetch.mockImplementation(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true
            });
          })
      );
      const result = expect(client.synchronizeTime()).rejects.toThrow("synchronization failed");
      await vi.advanceTimersByTimeAsync(50);
      await result;
      expect(vi.getTimerCount()).toBe(0);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
