import { Decimal, type Signal } from "@meridian/core";
import { describe, expect, it, vi } from "vitest";

import { createBasicRiskGate } from "./basic-risk-gate.js";

function signal(override: Partial<Signal> = {}): Signal {
  return {
    signalId: "sig_1",
    strategyId: "ema",
    createdAtMs: 1_000,
    validUntilMs: 2_000,
    intent: {
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: new Decimal("0.0002"),
      limitPrice: new Decimal("83000"),
      reason: "EMA bullish crossover"
    },
    ...override
  };
}

describe("createBasicRiskGate", () => {
  it("approves signals inside configured limits", async () => {
    const gate = createBasicRiskGate({
      limits: {
        minNotional: new Decimal("10"),
        maxNotional: new Decimal("100"),
        maxQuantity: new Decimal("0.001"),
        maxAbsolutePosition: new Decimal("0.01"),
        maxOpenOrders: 3
      },
      state: {
        positionQuantity: vi.fn(async () => new Decimal("0.001")),
        openOrderCount: vi.fn(async () => 1)
      }
    });

    await expect(gate.evaluate(signal())).resolves.toEqual({ approved: true });
  });

  it("rejects signals below minimum notional", async () => {
    const gate = createBasicRiskGate({
      limits: {
        minNotional: new Decimal("20")
      }
    });

    await expect(gate.evaluate(signal())).resolves.toEqual({
      approved: false,
      reason: "notional-below-minimum"
    });
  });

  it("rejects signals above max notional or quantity limits", async () => {
    const notionalGate = createBasicRiskGate({
      limits: {
        maxNotional: new Decimal("10")
      }
    });
    const quantityGate = createBasicRiskGate({
      limits: {
        maxQuantity: new Decimal("0.0001")
      }
    });

    await expect(notionalGate.evaluate(signal())).resolves.toEqual({
      approved: false,
      reason: "notional-above-limit"
    });
    await expect(quantityGate.evaluate(signal())).resolves.toEqual({
      approved: false,
      reason: "quantity-above-limit"
    });
  });

  it("uses injected market price for market-order notional checks", async () => {
    const gate = createBasicRiskGate({
      limits: {
        minNotional: new Decimal("10"),
        maxNotional: new Decimal("20")
      },
      state: {
        marketPrice: vi.fn(async () => new Decimal("83000"))
      }
    });

    await expect(
      gate.evaluate(
        signal({
          intent: {
            symbol: "BTCUSDT",
            side: "BUY",
            type: "MARKET",
            quantity: new Decimal("0.0002"),
            reason: "EMA bullish crossover"
          }
        })
      )
    ).resolves.toEqual({ approved: true });
  });

  it("fails closed when market price is required but unavailable", async () => {
    const gate = createBasicRiskGate({
      limits: {
        minNotional: new Decimal("10")
      }
    });

    await expect(
      gate.evaluate(
        signal({
          intent: {
            symbol: "BTCUSDT",
            side: "BUY",
            type: "MARKET",
            quantity: new Decimal("0.0002"),
            reason: "EMA bullish crossover"
          }
        })
      )
    ).resolves.toEqual({
      approved: false,
      reason: "risk-check-error:market price is required for market-order notional checks"
    });
  });

  it("rejects orders that would exceed the position limit", async () => {
    const gate = createBasicRiskGate({
      limits: {
        maxAbsolutePosition: new Decimal("0.01")
      },
      state: {
        positionQuantity: vi.fn(async () => new Decimal("0.0099"))
      }
    });

    await expect(gate.evaluate(signal())).resolves.toEqual({
      approved: false,
      reason: "position-above-limit"
    });
  });

  it("rejects when open orders are already at the configured limit", async () => {
    const gate = createBasicRiskGate({
      limits: {
        maxOpenOrders: 2
      },
      state: {
        openOrderCount: vi.fn(async () => 2)
      }
    });

    await expect(gate.evaluate(signal())).resolves.toEqual({
      approved: false,
      reason: "open-orders-at-limit"
    });
  });
});
