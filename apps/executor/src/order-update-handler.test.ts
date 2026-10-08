import { Decimal } from "@meridian/core";
import { describe, expect, it, vi } from "vitest";

import { handleUserDataOrderUpdate } from "./order-update-handler.js";
import type { UserDataOrderUpdate } from "@meridian/binance-client";

function update(override: Partial<UserDataOrderUpdate> = {}): UserDataOrderUpdate {
  return {
    kind: "order-update",
    subscriptionId: 1,
    eventTimeMs: 1_704_067_240_000,
    transactionTimeMs: 1_704_067_239_000,
    symbol: "BTCUSDT",
    clientOrderId: "mrd_order_1",
    originalClientOrderId: undefined,
    orderId: "123",
    executionId: "456",
    tradeId: undefined,
    side: "BUY",
    type: "LIMIT",
    status: "NEW",
    executionType: "NEW",
    quantity: new Decimal("0.0002"),
    price: new Decimal("83000.91"),
    lastQuantity: new Decimal("0"),
    lastPrice: new Decimal("0"),
    executedQuantity: new Decimal("0"),
    cumulativeQuoteQuantity: new Decimal("0"),
    commission: new Decimal("0"),
    commissionAsset: null,
    maker: false,
    ...override
  };
}

describe("handleUserDataOrderUpdate", () => {
  it("records partial fills with fee asset details", async () => {
    const store = { recordOrderExecutionUpdate: vi.fn(async () => undefined) };

    await handleUserDataOrderUpdate(
      update({
        status: "PARTIALLY_FILLED",
        executionType: "TRADE",
        tradeId: "789",
        executionId: "457",
        lastQuantity: new Decimal("0.0001"),
        lastPrice: new Decimal("83000.91"),
        executedQuantity: new Decimal("0.0001"),
        cumulativeQuoteQuantity: new Decimal("8.300091"),
        commission: new Decimal("0.000001"),
        commissionAsset: "BTC"
      }),
      { store }
    );

    expect(store.recordOrderExecutionUpdate).toHaveBeenCalledWith({
      clientOrderId: "mrd_order_1",
      exchangeOrderId: "123",
      state: "PARTIALLY_FILLED",
      executedQuantity: "0.0001",
      cumulativeQuoteQuantity: "8.300091",
      exchangeEventTimeMs: 1_704_067_240_000,
      executionId: "457",
      fill: {
        tradeId: "789",
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: "0.0001",
        price: "83000.91",
        fee: "0.000001",
        feeAsset: "BTC"
      }
    });
  });

  it("records non-trade status updates without a fill row", async () => {
    const store = { recordOrderExecutionUpdate: vi.fn(async () => undefined) };

    await handleUserDataOrderUpdate(
      update({
        status: "CANCELED",
        executionType: "CANCELED",
        executionId: "458"
      }),
      { store }
    );

    const record = (
      store.recordOrderExecutionUpdate as unknown as {
        readonly mock: { readonly calls: readonly [Record<string, unknown>][] };
      }
    ).mock.calls[0]?.[0];
    expect(record).toMatchObject({
      clientOrderId: "mrd_order_1",
      state: "CANCELED"
    });
    expect(record).not.toHaveProperty("fill");
  });

  it("uses original client order id for cancel execution reports when present", async () => {
    const store = { recordOrderExecutionUpdate: vi.fn(async () => undefined) };

    await handleUserDataOrderUpdate(
      update({
        clientOrderId: "generated-cancel-id",
        originalClientOrderId: "mrd_order_1",
        status: "CANCELED",
        executionType: "CANCELED"
      }),
      { store }
    );

    expect(store.recordOrderExecutionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        clientOrderId: "mrd_order_1"
      })
    );
  });

  it("fails closed when a trade fill has no commission asset", async () => {
    await expect(
      handleUserDataOrderUpdate(
        update({
          executionType: "TRADE",
          tradeId: "789",
          commission: new Decimal("0.1"),
          commissionAsset: null
        }),
        { store: { recordOrderExecutionUpdate: vi.fn() } }
      )
    ).rejects.toThrow("Trade fill commission asset is required");
  });
});
