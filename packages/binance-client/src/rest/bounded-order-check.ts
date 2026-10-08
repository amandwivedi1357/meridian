import { Decimal } from "@meridian/core";
import type { createTestnetTradingClient } from "./testnet-trading-client.js";

type TradingClient = Pick<
  ReturnType<typeof createTestnetTradingClient>,
  "placeOrder" | "queryOrder" | "cancelOrder" | "openOrders"
>;

export async function runBoundedOrderCheck(
  client: TradingClient,
  options: {
    symbol: string;
    quantity: string;
    price: string;
    clientOrderId: string;
  }
) {
  const quantity = new Decimal(options.quantity);
  const price = new Decimal(options.price);
  if (
    options.symbol !== "BTCUSDT" ||
    !quantity.isFinite() ||
    quantity.lte(0) ||
    quantity.gt("0.0002") ||
    !price.isFinite() ||
    price.lte(0) ||
    quantity.times(price).gt(25)
  ) {
    throw new Error(
      "Testnet verification bounds exceeded: BTCUSDT, 0.0002 BTC and 25 USDT maximum"
    );
  }
  const lookup = { symbol: options.symbol, clientOrderId: options.clientOrderId };
  let placedStatus: string | undefined;
  let queriedStatus: string | undefined;
  let canceledStatus: string | undefined;
  let failure: unknown;
  try {
    placedStatus = (
      await client.placeOrder({
        ...lookup,
        side: "BUY",
        type: "LIMIT",
        quantity: quantity.toFixed(),
        price: price.toFixed(),
        timeInForce: "GTC"
      })
    ).status;
    queriedStatus = (await client.queryOrder(lookup)).status;
  } catch (error) {
    failure = error;
  }
  // A failed placement response may still represent an accepted order. Never resend.
  try {
    const order = await client.queryOrder(lookup);
    if (["NEW", "PARTIALLY_FILLED", "PENDING_NEW", "PENDING_CANCEL"].includes(order.status)) {
      canceledStatus = (await client.cancelOrder(lookup)).status;
    }
    const terminal = await client.queryOrder(lookup);
    if (
      !["CANCELED", "FILLED", "EXPIRED", "EXPIRED_IN_MATCH", "REJECTED"].includes(terminal.status)
    ) {
      throw new Error("Verification order is not terminal; operator reconciliation required");
    }
    const stillOpen = (await client.openOrders({ symbol: options.symbol })).some(
      (order) => order.clientOrderId === options.clientOrderId
    );
    if (stillOpen)
      throw new Error("Verification order is still open; operator reconciliation required");
  } catch {
    throw new Error(
      `Unable to verify cleanup of Testnet order ${options.clientOrderId}; operator reconciliation required`
    );
  }
  if (failure !== undefined) throw failure;
  return {
    environment: "testnet",
    ...options,
    placedStatus,
    queriedStatus,
    canceledStatus,
    stillOpen: false,
    placementAttempts: 1
  };
}
