import { Decimal } from "@meridian/core";
import { describe, expect, it, vi } from "vitest";

import { publishSignal } from "./signal-publisher.js";

describe("publishSignal", () => {
  it("validates and publishes signals to the shared signals stream", async () => {
    const bus = {
      xAdd: vi.fn(async () => "1-0")
    };

    const id = await publishSignal(
      {
        signalId: "sig_1",
        strategyId: "ema",
        createdAtMs: 1_000,
        validUntilMs: 2_000,
        intent: {
          symbol: "BTCUSDT",
          side: "BUY",
          type: "LIMIT",
          quantity: new Decimal("0.0002"),
          limitPrice: new Decimal("83000.91"),
          reason: "EMA bullish crossover"
        }
      },
      { bus }
    );

    expect(id).toBe("1-0");
    expect(bus.xAdd).toHaveBeenCalledWith(
      "signals",
      "*",
      expect.objectContaining({
        kind: "signal",
        signalId: "sig_1"
      })
    );
    const call = bus.xAdd.mock.calls[0] as
      | [string, "*", { readonly payload: string }]
      | undefined;
    if (call === undefined) throw new Error("Expected XADD call");
    const payload = JSON.parse(call[2].payload);
    expect(payload).toMatchObject({
      signalId: "sig_1",
      strategyId: "ema",
      intent: {
        symbol: "BTCUSDT",
        quantity: "0.0002",
        limitPrice: "83000.91"
      }
    });
  });

  it("rejects invalid signals before publishing", async () => {
    const bus = {
      xAdd: vi.fn(async () => "1-0")
    };

    await expect(
      publishSignal(
        {
          signalId: "",
          strategyId: "ema",
          createdAtMs: 1_000,
          validUntilMs: 2_000,
          intent: {
            symbol: "BTCUSDT",
            side: "BUY",
            type: "MARKET",
            quantity: new Decimal("0.0002"),
            reason: "EMA bullish crossover"
          }
        },
        { bus }
      )
    ).rejects.toThrow("signalId");
    expect(bus.xAdd).not.toHaveBeenCalled();
  });
});
