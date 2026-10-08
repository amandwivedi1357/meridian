import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";

import {
  createSignal,
  isSignalExpired,
  parseSignalPayload,
  serializeSignal,
  type Signal
} from "./signal.js";

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
      limitPrice: new Decimal("83000.91"),
      reason: "EMA bullish crossover"
    },
    ...override
  };
}

describe("Signal", () => {
  it("accepts a valid signal with an expiry and order intent", () => {
    expect(createSignal(signal())).toEqual(signal());
  });

  it("rejects invalid identifiers and expiry windows", () => {
    expect(() => createSignal(signal({ signalId: "" }))).toThrow("signalId");
    expect(() => createSignal(signal({ validUntilMs: 1_000 }))).toThrow(
      "validUntilMs must be after createdAtMs"
    );
  });

  it("serializes and parses transport payloads without decimal precision loss", () => {
    const value = signal({
      signalId: "sig_transport_1",
      intent: {
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        quantity: new Decimal("0.000200000000000001"),
        limitPrice: new Decimal("83000.910000000000000001"),
        reason: "EMA bullish crossover"
      }
    });

    const serialized = serializeSignal(value);
    const parsed = parseSignalPayload(JSON.stringify(serialized));

    expect(serialized.intent.quantity).toBe("0.000200000000000001");
    expect(serialized.intent.limitPrice).toBe("83000.910000000000000001");
    expect(parsed.intent.quantity.toFixed()).toBe("0.000200000000000001");
    expect(parsed.intent.limitPrice?.toFixed()).toBe("83000.910000000000000001");
  });

  it("rejects malformed transport payloads", () => {
    expect(() =>
      parseSignalPayload(
        JSON.stringify({
          signalId: "sig_1",
          strategyId: "ema",
          createdAtMs: 1_000,
          validUntilMs: 2_000,
          intent: {
            symbol: "btcusdt",
            side: "BUY",
            type: "LIMIT",
            quantity: "0.0002",
            limitPrice: "83000.91",
            reason: "EMA bullish crossover"
          }
        })
      )
    ).toThrow("symbol");
  });

  it("detects expiry only after the valid-until timestamp", () => {
    const value = signal({ validUntilMs: 2_000 });

    expect(isSignalExpired(value, 2_000)).toBe(false);
    expect(isSignalExpired(value, 2_001)).toBe(true);
  });
});
