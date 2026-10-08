import { describe, expect, it, vi } from "vitest";
import { runBoundedOrderCheck } from "./bounded-order-check.js";

const options = {
  symbol: "BTCUSDT",
  quantity: "0.0002",
  price: "83000",
  clientOrderId: "verification"
};
function client() {
  return {
    placeOrder: vi.fn().mockResolvedValue({ status: "NEW" }),
    queryOrder: vi
      .fn()
      .mockResolvedValueOnce({ status: "NEW" })
      .mockResolvedValueOnce({ status: "NEW" })
      .mockResolvedValue({ status: "CANCELED" }),
    cancelOrder: vi.fn().mockResolvedValue({ status: "CANCELED" }),
    openOrders: vi.fn().mockResolvedValue([{ clientOrderId: "unrelated" }])
  };
}
describe("bounded Testnet verification", () => {
  it.each([
    { symbol: "ETHUSDT" },
    { quantity: "0.00021" },
    { price: "125001" },
    { quantity: "0" },
    { price: "NaN" }
  ])("refuses exceeded bounds before any request: %j", async (override) => {
    const trading = client();
    await expect(runBoundedOrderCheck(trading, { ...options, ...override })).rejects.toThrow(
      "bounds exceeded"
    );
    expect(trading.placeOrder).not.toHaveBeenCalled();
    expect(trading.queryOrder).not.toHaveBeenCalled();
  });
  it("cancels only its own order and verifies terminal state", async () => {
    const trading = client();
    expect(await runBoundedOrderCheck(trading, options)).toMatchObject({
      stillOpen: false,
      placementAttempts: 1
    });
    expect(trading.cancelOrder).toHaveBeenCalledOnce();
    expect(trading.cancelOrder).toHaveBeenCalledWith({
      symbol: options.symbol,
      clientOrderId: options.clientOrderId
    });
  });
  it("cleans up an accepted order after a lost placement response without resending", async () => {
    const trading = client();
    trading.placeOrder.mockRejectedValue(new Error("lost response"));
    trading.queryOrder
      .mockReset()
      .mockResolvedValueOnce({ status: "NEW" })
      .mockResolvedValue({ status: "CANCELED" });
    await expect(runBoundedOrderCheck(trading, options)).rejects.toThrow("lost response");
    expect(trading.placeOrder).toHaveBeenCalledOnce();
    expect(trading.cancelOrder).toHaveBeenCalledOnce();
  });
  it("reports unresolved cleanup rather than claiming success", async () => {
    const trading = client();
    trading.cancelOrder.mockRejectedValue(new Error("network down"));
    await expect(runBoundedOrderCheck(trading, options)).rejects.toThrow(
      "operator reconciliation required"
    );
  });
});
