import { describe, expect, it, vi } from "vitest";

import { BinanceSignedRequestError } from "./authenticated-http.js";
import { createQueryBeforeRetryOrderSubmitter } from "./safe-order-submission.js";
import type { BinanceOrderResponse, PlaceOrderParams } from "./order-schemas.js";

const placeOrder: PlaceOrderParams = {
  symbol: "BTCUSDT",
  side: "BUY",
  type: "LIMIT",
  quantity: "0.0002",
  price: "83000.91",
  timeInForce: "GTC",
  clientOrderId: "mrd_order_1"
};

const responseOrder: BinanceOrderResponse = {
  symbol: "BTCUSDT",
  orderId: 123,
  orderListId: -1,
  clientOrderId: "mrd_order_1",
  price: "83000.91",
  origQty: "0.0002",
  executedQty: "0",
  cummulativeQuoteQty: "0",
  status: "NEW",
  timeInForce: "GTC",
  type: "LIMIT",
  side: "BUY",
  transactTime: 2_000
};

function createClient() {
  return {
    placeOrder: vi.fn(async () => responseOrder),
    queryOrder: vi.fn(async () => responseOrder)
  };
}

describe("createQueryBeforeRetryOrderSubmitter", () => {
  it("returns the placement response when the exchange accepts the order", async () => {
    const client = createClient();
    const submitter = createQueryBeforeRetryOrderSubmitter(client);

    await expect(submitter.placeOrder(placeOrder)).resolves.toEqual({
      order: responseOrder,
      source: "placement"
    });
    expect(client.placeOrder).toHaveBeenCalledTimes(1);
    expect(client.queryOrder).not.toHaveBeenCalled();
  });

  it("queries by clientOrderId after an unknown placement outcome instead of resending", async () => {
    const client = createClient();
    client.placeOrder.mockRejectedValueOnce(new BinanceSignedRequestError("unknown"));
    const submitter = createQueryBeforeRetryOrderSubmitter(client);

    await expect(submitter.placeOrder(placeOrder)).resolves.toEqual({
      order: responseOrder,
      source: "query-after-unknown"
    });

    expect(client.placeOrder).toHaveBeenCalledTimes(1);
    expect(client.queryOrder).toHaveBeenCalledTimes(1);
    expect(client.queryOrder).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      clientOrderId: "mrd_order_1"
    });
  });

  it("does not query or retry when Binance rejects the placement deterministically", async () => {
    const client = createClient();
    const error = new BinanceSignedRequestError("rejected", 400, -1013);
    client.placeOrder.mockRejectedValueOnce(error);
    const submitter = createQueryBeforeRetryOrderSubmitter(client);

    await expect(submitter.placeOrder(placeOrder)).rejects.toBe(error);
    expect(client.placeOrder).toHaveBeenCalledTimes(1);
    expect(client.queryOrder).not.toHaveBeenCalled();
  });

  it("propagates query failures after an unknown placement without resending", async () => {
    const client = createClient();
    const queryError = new BinanceSignedRequestError("unknown");
    client.placeOrder.mockRejectedValueOnce(new BinanceSignedRequestError("unknown"));
    client.queryOrder.mockRejectedValueOnce(queryError);
    const submitter = createQueryBeforeRetryOrderSubmitter(client);

    await expect(submitter.placeOrder(placeOrder)).rejects.toBe(queryError);
    expect(client.placeOrder).toHaveBeenCalledTimes(1);
    expect(client.queryOrder).toHaveBeenCalledTimes(1);
  });
});
