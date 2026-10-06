import { describe, expect, it, vi } from "vitest";
import {
  BinanceSignedRequestError,
  createAuthenticatedHttp,
  type AuthenticatedHttpOptions
} from "./authenticated-http.js";
import { createHmacSigner } from "./signing.js";
import { createServerTimeClock } from "./server-time-clock.js";

const apiKey = "test-only-api-key";
const signer = createHmacSigner("test-only-secret");

function setup(overrides: Partial<AuthenticatedHttpOptions> = {}) {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ orderId: 123 }), { status: 200 }));
  const client = createAuthenticatedHttp({ apiKey, signer, now: () => 2_000, fetch, ...overrides });
  return { client, fetch };
}

describe("createAuthenticatedHttp", () => {
  it("defaults to Testnet and sends a signed GET with the API-key header", async () => {
    const { client, fetch } = setup();
    await expect(
      client.request({ method: "GET", path: "/api/v3/order", parameters: { symbol: "BTCUSDT" } })
    ).resolves.toEqual({ orderId: 123 });
    const [input, init] = fetch.mock.calls[0]!;
    const payload = "symbol=BTCUSDT&recvWindow=5000&timestamp=2000";
    expect(String(input)).toBe(
      `https://testnet.binance.vision/api/v3/order?${payload}&signature=${signer.sign(payload)}`
    );
    expect(new Headers(init?.headers).get("X-MBX-APIKEY")).toBe(apiKey);
    expect(init?.redirect).toBe("error");
    expect(init?.body).toBeUndefined();
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sends POST parameters as an encoded body without duplicating them in the URL", async () => {
    const { client, fetch } = setup({ recvWindowMs: 3_000 });
    await client.request({
      method: "POST",
      path: "/api/v3/order/test",
      parameters: { quantity: "0.00100000" }
    });
    const [input, init] = fetch.mock.calls[0]!;
    const payload = "quantity=0.00100000&recvWindow=3000&timestamp=2000";
    expect(String(input)).toBe("https://testnet.binance.vision/api/v3/order/test");
    expect(init?.body).toBe(`${payload}&signature=${signer.sign(payload)}`);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Content-Type")).toBe(
      "application/x-www-form-urlencoded"
    );
  });

  it("sends DELETE parameters in the signed query", async () => {
    const { client, fetch } = setup();
    await client.request({ method: "DELETE", path: "/api/v3/order" });
    expect(fetch.mock.calls[0]?.[1]?.method).toBe("DELETE");
    expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get("signature")).not.toBeNull();
  });

  it("rejects production before signing or fetching", () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const sign = vi.fn(() => "signature");
    expect(() =>
      createAuthenticatedHttp({
        apiKey,
        signer: { sign },
        now: () => 0,
        environment: "production",
        fetch
      })
    ).toThrow("Testnet only");
    expect(fetch).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });

  it.each(["", " ", "key\nvalue", "key value", "\u00e9"])(
    "rejects an invalid API-key token %j",
    (value) => {
      expect(() => setup({ apiKey: value })).toThrow("API key");
    }
  );

  it.each([0, -1, 1.5, NaN, Infinity, 2_147_483_648])(
    "rejects invalid timeouts %s",
    (timeoutMs) => {
      expect(() => setup({ timeoutMs })).toThrow("timeout");
    }
  );

  it.each([
    "https://api.binance.com/api/v3/order",
    "//evil.example/api/v3/order",
    "/api/v3/../order",
    "/api/v3/%2e%2e/order",
    "/api/v3/order?x=1",
    "/api/v3/order#fragment",
    "/api/v3/order\\other",
    "/sapi/v1/account"
  ])("rejects unsafe paths %s before fetching", async (path) => {
    const { client, fetch } = setup();
    await expect(client.request({ method: "GET", path })).rejects.toThrow("endpoint path");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not send when the clock is unsynchronized or stale", async () => {
    let localNow = 1_000;
    const clock = createServerTimeClock({
      nowMs: () => localNow,
      getServerTime: async () => ({ serverTime: 2_000 })
    });
    const { client, fetch } = setup({ now: clock.now });
    await expect(client.request({ method: "GET", path: "/api/v3/account" })).rejects.toThrow(
      "not synchronized"
    );
    await clock.synchronize();
    localNow += 60_000;
    await expect(client.request({ method: "POST", path: "/api/v3/order" })).rejects.toThrow(
      "resynchronization"
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses signing-field overrides before fetching", async () => {
    const { client, fetch } = setup();
    await expect(
      client.request({ method: "POST", path: "/api/v3/order", parameters: { timestamp: "0" } })
    ).rejects.toThrow("cannot be overridden");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { status: 400, code: -2010, outcome: "rejected" },
    { status: 401, code: -2015, outcome: "rejected" },
    { status: 418, code: -1003, outcome: "rejected" },
    { status: 429, code: -1003, outcome: "rejected" },
    { status: 400, code: -1006, outcome: "unknown" },
    { status: 400, code: -1007, outcome: "unknown" },
    { status: 408, code: -1007, outcome: "unknown" },
    { status: 409, code: -2021, outcome: "unknown" },
    { status: 500, code: -1000, outcome: "unknown" },
    { status: 503, code: -1000, outcome: "unknown" },
    { status: 200, code: -1007, outcome: "unknown" }
  ])(
    "classifies $status / $code as $outcome without retrying",
    async ({ status, code, outcome }) => {
      const { client, fetch } = setup();
      fetch.mockResolvedValue(
        new Response(JSON.stringify({ code, msg: "sensitive upstream content" }), {
          status,
          headers: { "Retry-After": "60" }
        })
      );
      await expect(client.request({ method: "POST", path: "/api/v3/order" })).rejects.toMatchObject(
        {
          name: "BinanceSignedRequestError",
          status,
          code,
          outcome,
          retryAfter: "60"
        }
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  );

  it("sanitizes network errors and marks the outcome unknown without retrying", async () => {
    const { client, fetch } = setup();
    fetch.mockRejectedValue(new Error(`Failed URL?signature=sensitive&apiKey=${apiKey}`));
    const error = await client
      .request({ method: "POST", path: "/api/v3/order" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BinanceSignedRequestError);
    expect(error).toMatchObject({ outcome: "unknown" });
    expect(String(error)).not.toContain(apiKey);
    expect(String(error)).not.toContain("sensitive");
    expect(error).not.toHaveProperty("cause");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("treats malformed successful JSON as unknown without retrying", async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(new Response("not JSON", { status: 200 }));
    await expect(client.request({ method: "POST", path: "/api/v3/order" })).rejects.toMatchObject({
      outcome: "unknown"
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("marks body-read errors unknown without exposing upstream data", async () => {
    const { client, fetch } = setup();
    const response = new Response("{}");
    vi.spyOn(response, "text").mockRejectedValue(new Error("private body details"));
    fetch.mockResolvedValue(response);
    await expect(client.request({ method: "POST", path: "/api/v3/order" })).rejects.toMatchObject({
      outcome: "unknown"
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("aborts a timed-out request, does not retry, and clears its timer", async () => {
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
      const result = expect(
        client.request({ method: "POST", path: "/api/v3/order" })
      ).rejects.toMatchObject({ outcome: "unknown" });
      await vi.advanceTimersByTimeAsync(50);
      await result;
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the timeout after successful completion", async () => {
    vi.useFakeTimers();
    try {
      await setup().client.request({ method: "GET", path: "/api/v3/account" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
