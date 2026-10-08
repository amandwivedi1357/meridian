import { Decimal } from "@meridian/core";
import { describe, expect, it, vi } from "vitest";

import { BinanceSignedRequestError } from "./authenticated-http.js";
import { createBinanceReconciliationExchange } from "./reconciliation-exchange.js";
import type { BinanceOrderResponse } from "./order-schemas.js";

const order: BinanceOrderResponse = {
  symbol: "BTCUSDT",
  orderId: 123,
  orderListId: -1,
  clientOrderId: "client-1",
  price: "83000.91000000",
  origQty: "0.00020000",
  executedQty: "0.00000000",
  cummulativeQuoteQty: "0.00000000",
  status: "NEW",
  timeInForce: "GTC",
  type: "LIMIT",
  side: "BUY",
  updateTime: 1_704_067_200_000
};

function createClient(response: BinanceOrderResponse = order) {
  return {
    queryOrder: vi.fn(async () => response)
  };
}

describe("createBinanceReconciliationExchange", () => {
  it("queries Binance by original client order id and maps snapshots for reconciliation", async () => {
    const client = createClient();
    const exchange = createBinanceReconciliationExchange({ client });

    const snapshot = await exchange.getOrder({
      symbol: "BTCUSDT",
      clientOrderId: "client-1"
    });

    expect(client.queryOrder).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      clientOrderId: "client-1"
    });
    expect(snapshot).toMatchObject({
      clientOrderId: "client-1",
      exchangeOrderId: "123",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      status: "NEW",
      eventTimeMs: 1_704_067_200_000
    });
    expect(snapshot?.price).toEqual(new Decimal("83000.91"));
    expect(snapshot?.executedQuantity).toEqual(new Decimal("0"));
    expect(snapshot?.cumulativeQuoteQuantity).toEqual(new Decimal("0"));
  });

  it.each([-2011, -2013])(
    "returns null when Binance reports that the order is not found with code %s",
    async (code) => {
      const client = createClient();
      client.queryOrder.mockRejectedValue(new BinanceSignedRequestError("rejected", 400, code));
      const exchange = createBinanceReconciliationExchange({ client });

      await expect(
        exchange.getOrder({
          symbol: "BTCUSDT",
          clientOrderId: "missing"
        })
      ).resolves.toBeNull();
    }
  );

  it("rethrows transient signed-request failures so reconciliation can report query failure", async () => {
    const client = createClient();
    const error = new BinanceSignedRequestError("unknown", 504, -1007);
    client.queryOrder.mockRejectedValue(error);
    const exchange = createBinanceReconciliationExchange({ client });

    await expect(
      exchange.getOrder({
        symbol: "BTCUSDT",
        clientOrderId: "maybe-live"
      })
    ).rejects.toBe(error);
  });

  it("uses the requested client order id when Binance returns an origClientOrderId", async () => {
    const client = createClient({
      ...order,
      clientOrderId: "generated-cancel-id",
      origClientOrderId: "client-1",
      status: "CANCELED"
    });
    const exchange = createBinanceReconciliationExchange({ client });

    const snapshot = await exchange.getOrder({
      symbol: "BTCUSDT",
      clientOrderId: "client-1"
    });

    expect(snapshot?.clientOrderId).toBe("client-1");
    expect(snapshot?.status).toBe("CANCELED");
  });
});
