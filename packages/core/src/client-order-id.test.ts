import { describe, expect, it } from "vitest";

import {
  createClientOrderId,
  type ClientOrderIdInput,
  type ClientOrderIdPrefix
} from "./client-order-id.js";

const input: ClientOrderIdInput = {
  prefix: "mrd",
  strategyId: "ema-cross-12-26",
  signalId: "BTCUSDT:2024-01-01T00:15:00.000Z:BUY",
  attempt: 0
};

describe("createClientOrderId", () => {
  it("creates deterministic Binance-safe client order ids", () => {
    const first = createClientOrderId(input);
    const second = createClientOrderId(input);

    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{1,36}$/);
    expect(first.length).toBeLessThanOrEqual(36);
    expect(first.startsWith("mrd_")).toBe(true);
  });

  it("changes when the strategy, signal, or attempt changes", () => {
    const base = createClientOrderId(input);

    expect(createClientOrderId({ ...input, strategyId: "grid" })).not.toBe(base);
    expect(createClientOrderId({ ...input, signalId: "different-signal" })).not.toBe(base);
    expect(createClientOrderId({ ...input, attempt: 1 })).not.toBe(base);
  });

  it("keeps ids stable for source values that need normalization", () => {
    const id = createClientOrderId({
      prefix: "Meridian_Bot",
      strategyId: "Strategy With Spaces / 🚀",
      signalId: "BTCUSDT|2024-01-01|BUY|0.001",
      attempt: 12
    });

    expect(id).toMatch(/^Meridian_Bot_/);
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,36}$/);
    expect(id.length).toBeLessThanOrEqual(36);
  });

  it.each([
    { name: "blank prefix", value: { ...input, prefix: "" } },
    { name: "too long prefix", value: { ...input, prefix: "x".repeat(25) } },
    { name: "unsafe prefix", value: { ...input, prefix: "bad.prefix" } },
    { name: "blank strategy", value: { ...input, strategyId: "" } },
    { name: "blank signal", value: { ...input, signalId: "" } },
    { name: "negative attempt", value: { ...input, attempt: -1 } },
    { name: "unsafe attempt", value: { ...input, attempt: Number.MAX_SAFE_INTEGER + 1 } }
  ])("rejects invalid input: $name", ({ value }) => {
    expect(() => createClientOrderId(value as ClientOrderIdInput)).toThrow();
  });

  it("supports a narrow prefix type for call sites that want a named alias", () => {
    const prefix: ClientOrderIdPrefix = "mrd";

    expect(createClientOrderId({ ...input, prefix })).toMatch(/^mrd_/);
  });
});
