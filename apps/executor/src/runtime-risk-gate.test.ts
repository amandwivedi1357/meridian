import { Decimal, type Signal } from "@meridian/core";
import { describe, expect, it, vi } from "vitest";
import { createRuntimeRiskGate } from "./runtime-risk-gate.js";

const signal: Signal = {
  signalId: "signal",
  strategyId: "ema",
  createdAtMs: 1,
  validUntilMs: 2000,
  intent: {
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    quantity: new Decimal("0.0002"),
    limitPrice: new Decimal("83000"),
    reason: "test"
  }
};
function options() {
  return {
    env: {},
    assertReady: vi.fn(async () => undefined),
    getBaseAsset: vi.fn(async () => "BTC"),
    getBalances: vi.fn(async () => [
      { asset: "BTC", free: new Decimal("0"), locked: new Decimal("0") }
    ]),
    getMarketPrice: vi.fn(async () => new Decimal("83000")),
    getOpenOrderCount: vi.fn(async () => 0)
  };
}
describe("runtime risk gate", () => {
  it("reads exchange metadata and balances before approving", async () => {
    const deps = options();
    await expect(createRuntimeRiskGate(deps).evaluate(signal)).resolves.toEqual({ approved: true });
    expect(deps.assertReady).toHaveBeenCalledOnce();
    expect(deps.getBaseAsset).toHaveBeenCalledWith("BTCUSDT");
    expect(deps.getBalances).toHaveBeenCalledOnce();
  });
  it("blocks orders while user-data tracking is unavailable", async () => {
    const deps = options();
    deps.assertReady.mockRejectedValue(new Error("tracking unavailable"));
    await expect(createRuntimeRiskGate(deps).evaluate(signal)).rejects.toThrow(
      "tracking unavailable"
    );
    expect(deps.getBalances).not.toHaveBeenCalled();
  });
  it("rejects unavailable balances and existing open orders", async () => {
    const deps = options();
    deps.getBalances.mockResolvedValueOnce([]);
    const gate = createRuntimeRiskGate(deps);
    await expect(gate.evaluate(signal)).resolves.toMatchObject({ approved: false });
    deps.getOpenOrderCount.mockResolvedValue(1);
    await expect(gate.evaluate(signal)).resolves.toEqual({
      approved: false,
      reason: "open-orders-at-limit"
    });
  });
  it("rejects invalid limits before any network work", () => {
    const deps = options();
    expect(() => createRuntimeRiskGate({ ...deps, env: { EXECUTOR_MAX_NOTIONAL: "NaN" } })).toThrow(
      "Invalid EXECUTOR_MAX_NOTIONAL"
    );
    expect(deps.getBalances).not.toHaveBeenCalled();
  });
});
