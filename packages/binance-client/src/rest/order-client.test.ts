import { describe, expect, it, vi } from "vitest";
import { BinanceSignedRequestError } from "./authenticated-http.js";
import { createBinanceOrderClient } from "./order-client.js";
import type { PlaceOrderParams } from "./order-schemas.js";
import { createHmacSigner } from "./signing.js";

const marketOrder: PlaceOrderParams = {
  symbol: "BTCUSDT",
  side: "BUY",
  type: "MARKET",
  quantity: "0.00100000",
  clientOrderId: "meridian-test-1"
};
const responseOrder = {
  symbol: "BTCUSDT",
  orderId: 123,
  orderListId: -1,
  clientOrderId: "meridian-test-1",
  price: "0.00000000",
  origQty: "0.00100000",
  executedQty: "0.00100000",
  cummulativeQuoteQty: "85.00000000",
  status: "FILLED",
  timeInForce: "GTC",
  type: "MARKET",
  side: "BUY",
  transactTime: 2_000,
  fills: [
    {
      price: "85000.00000000",
      qty: "0.00100000",
      commission: "0.08500000",
      commissionAsset: "USDT",
      tradeId: 456
    }
  ]
};

function setup(response: unknown = responseOrder) {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(new Response(JSON.stringify(response)));
  const acquire = vi.fn<(weight: number) => Promise<void>>(async () => {});
  const client = createBinanceOrderClient({
    apiKey: "test-only-api-key",
    signer: createHmacSigner("test-only-secret"),
    now: () => 2_000,
    fetch,
    rateLimiter: { acquire }
  });
  return { client, fetch, acquire };
}

describe("createBinanceOrderClient", () => {
  it("places a MARKET order with an explicit ID and preserves decimal strings and fees", async () => {
    const { client, fetch, acquire } = setup();
    const result = await client.placeOrder(marketOrder);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://testnet.binance.vision/api/v3/order");
    expect(init?.method).toBe("POST");
    const parameters = new URLSearchParams(String(init?.body));
    expect(parameters.get("quantity")).toBe("0.00100000");
    expect(parameters.get("newClientOrderId")).toBe(marketOrder.clientOrderId);
    expect(parameters.get("newOrderRespType")).toBe("FULL");
    expect(parameters.has("price")).toBe(false);
    expect(parameters.has("timeInForce")).toBe(false);
    expect(result.origQty).toBe("0.00100000");
    expect(result.fills?.[0]?.commission).toBe("0.08500000");
    expect(acquire).toHaveBeenCalledWith(1);
  });

  it.each(["GTC", "IOC", "FOK"] as const)("places a LIMIT order with %s", async (timeInForce) => {
    const { client, fetch } = setup({
      ...responseOrder,
      type: "LIMIT",
      status: "NEW",
      price: "85000.12000000",
      executedQty: "0"
    });
    await client.placeOrder({
      ...marketOrder,
      type: "LIMIT",
      price: "85000.12000000",
      timeInForce
    });
    const parameters = new URLSearchParams(String(fetch.mock.calls[0]?.[1]?.body));
    expect(parameters.get("price")).toBe("85000.12000000");
    expect(parameters.get("timeInForce")).toBe(timeInForce);
  });

  it("queries an order by origClientOrderId", async () => {
    const { client, fetch, acquire } = setup();
    await client.queryOrder({ symbol: "BTCUSDT", clientOrderId: marketOrder.clientOrderId });
    const [input, init] = fetch.mock.calls[0]!;
    const url = new URL(String(input));
    expect(init?.method).toBe("GET");
    expect(url.searchParams.get("origClientOrderId")).toBe(marketOrder.clientOrderId);
    expect(url.searchParams.has("orderId")).toBe(false);
    expect(acquire).toHaveBeenCalledWith(4);
  });

  it("cancels by origClientOrderId and accepts Binance's changed cancellation ID", async () => {
    const { client, fetch, acquire } = setup({
      ...responseOrder,
      status: "CANCELED",
      origClientOrderId: marketOrder.clientOrderId,
      clientOrderId: "generated-cancel-id"
    });
    const result = await client.cancelOrder({
      symbol: "BTCUSDT",
      clientOrderId: marketOrder.clientOrderId
    });
    expect(fetch.mock.calls[0]?.[1]?.method).toBe("DELETE");
    expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get("origClientOrderId")).toBe(
      marketOrder.clientOrderId
    );
    expect(result.clientOrderId).toBe("generated-cancel-id");
    expect(acquire).toHaveBeenCalledWith(1);
  });

  it("lists open orders for one symbol with weight 6", async () => {
    const { client, fetch, acquire } = setup([{ ...responseOrder, status: "NEW" }]);
    expect(await client.openOrders({ symbol: "BTCUSDT" })).toHaveLength(1);
    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/api/v3/openOrders");
    expect(url.searchParams.get("symbol")).toBe("BTCUSDT");
    expect(acquire).toHaveBeenCalledWith(6);
  });

  it("supports an empty all-symbol list with weight 80", async () => {
    const { client, fetch, acquire } = setup([]);
    expect(await client.openOrders()).toEqual([]);
    expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.has("symbol")).toBe(false);
    expect(acquire).toHaveBeenCalledWith(80);
  });

  it.each([
    { quantity: "0" },
    { quantity: "0.00000" },
    { quantity: "-1" },
    { quantity: "NaN" },
    { quantity: "Infinity" },
    { quantity: "1e-3" },
    { quantity: 0.001 },
    { quantity: " 0.001" },
    { symbol: "btcusdt" },
    { symbol: "" },
    { side: "INVALID" },
    { clientOrderId: "" },
    { clientOrderId: "x".repeat(37) },
    { clientOrderId: "unsafe&id" },
    { type: "STOP_MARKET" },
    { price: "1" },
    { timeInForce: "GTC" },
    { timestamp: "0" },
    { quoteOrderQty: "100" },
    { type: "LIMIT", price: "1" },
    { type: "LIMIT", price: "0", timeInForce: "GTC" },
    { type: "LIMIT", price: "1", timeInForce: "BAD" }
  ])("rejects invalid place parameters %j without sending", async (changes) => {
    const { client, fetch, acquire } = setup();
    const input = { ...marketOrder, ...changes } as PlaceOrderParams;
    await expect(client.placeOrder(input)).rejects.toThrow("Invalid place-order parameters");
    expect(acquire).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects invalid lookup and list input before throttling or sending", async () => {
    const { client, fetch, acquire } = setup();
    await expect(client.queryOrder({ symbol: "BTCUSDT", clientOrderId: "" })).rejects.toThrow(
      "lookup"
    );
    await expect(client.cancelOrder({ symbol: "", clientOrderId: "id" })).rejects.toThrow("lookup");
    await expect(client.openOrders({ symbol: "" })).rejects.toThrow("open-orders");
    expect(fetch).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
  });

  it.each([
    { orderId: Number.MAX_SAFE_INTEGER + 1 },
    { origQty: 0.001 },
    { executedQty: "NaN" },
    { price: "-1" },
    { status: "MYSTERY" },
    { symbol: "ETHUSDT" },
    { clientOrderId: "another-order" },
    { side: "SELL" },
    { type: "LIMIT" },
    { fills: [{ commission: "NaN" }] }
  ])("marks malformed or mismatched placement responses unknown: %j", async (changes) => {
    const { client, fetch } = setup({ ...responseOrder, ...changes });
    await expect(client.placeOrder(marketOrder)).rejects.toMatchObject({ outcome: "unknown" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects ACK-only placement responses without assuming placement failed", async () => {
    const { client } = setup({
      symbol: "BTCUSDT",
      orderId: 123,
      clientOrderId: marketOrder.clientOrderId
    });
    await expect(client.placeOrder(marketOrder)).rejects.toBeInstanceOf(BinanceSignedRequestError);
  });

  it("rejects a cancellation response for another original order", async () => {
    const { client } = setup({
      ...responseOrder,
      origClientOrderId: "different-order",
      status: "CANCELED"
    });
    await expect(
      client.cancelOrder({ symbol: "BTCUSDT", clientOrderId: marketOrder.clientOrderId })
    ).rejects.toMatchObject({ outcome: "unknown" });
  });

  it("preserves historical unavailable cumulative quote quantity", async () => {
    const { client } = setup({ ...responseOrder, cummulativeQuoteQty: "-1.00000000" });
    const order = await client.queryOrder({
      symbol: "BTCUSDT",
      clientOrderId: marketOrder.clientOrderId
    });
    expect(order.cummulativeQuoteQty).toBe("-1.00000000");
  });

  it.each([
    { name: "non-array", value: responseOrder },
    { name: "malformed member", value: [{}] },
    { name: "wrong symbol", value: [{ ...responseOrder, symbol: "ETHUSDT" }] }
  ])("rejects an invalid open-order response: $name", async ({ value }) => {
    const { client } = setup(value);
    await expect(client.openOrders({ symbol: "BTCUSDT" })).rejects.toMatchObject({
      outcome: "unknown"
    });
  });

  it("waits for weight acquisition before creating the timestamp", async () => {
    let time = 2_000;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify(responseOrder)));
    const client = createBinanceOrderClient({
      apiKey: "test-only-api-key",
      signer: createHmacSigner("test-only-secret"),
      now: () => time,
      fetch,
      rateLimiter: {
        acquire: async () => {
          time = 3_000;
        }
      }
    });
    await client.queryOrder({ symbol: "BTCUSDT", clientOrderId: marketOrder.clientOrderId });
    expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get("timestamp")).toBe("3000");
  });

  it("does not send when throttling fails", async () => {
    const { client, fetch, acquire } = setup();
    acquire.mockRejectedValueOnce(new Error("Limiter unavailable"));
    await expect(client.placeOrder(marketOrder)).rejects.toThrow("Limiter unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("propagates unknown network outcomes without resubmission", async () => {
    const { client, fetch } = setup();
    fetch.mockRejectedValueOnce(new Error("network offline"));
    await expect(client.placeOrder(marketOrder)).rejects.toMatchObject({ outcome: "unknown" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("inherits the production refusal guard", () => {
    expect(() =>
      createBinanceOrderClient({
        apiKey: "test-only-api-key",
        signer: createHmacSigner("test-only-secret"),
        now: () => 0,
        environment: "production"
      })
    ).toThrow("Testnet only");
  });
});
