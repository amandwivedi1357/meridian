import { describe, expect, it, vi } from "vitest";

import { runUnknownOrderResolution } from "./unknown-order-resolution.js";

const localUnknown = {
  clientOrderId: "mrd_unknown",
  symbol: "BTCUSDT",
  state: "UNKNOWN" as const,
  exchangeOrderId: null
};

describe("runUnknownOrderResolution", () => {
  it("resolves a locally UNKNOWN order as not sent only after the exchange reports it missing", async () => {
    const store = {
      getOrderForUnknownResolution: vi.fn(async () => localUnknown),
      resolveUnknownOrderAsNotSent: vi.fn(async () => {})
    };
    const exchange = {
      getOrder: vi.fn(async () => null)
    };

    await expect(
      runUnknownOrderResolution({
        clientOrderId: "mrd_unknown",
        actor: "local-operator:test",
        reason: "exchange-query-missing-after-downtime",
        nowMs: () => 1_704_067_200_000,
        store,
        exchange
      })
    ).resolves.toEqual({
      outcome: "resolved-not-sent",
      clientOrderId: "mrd_unknown",
      symbol: "BTCUSDT"
    });

    expect(exchange.getOrder).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      clientOrderId: "mrd_unknown"
    });
    expect(store.resolveUnknownOrderAsNotSent).toHaveBeenCalledWith({
      clientOrderId: "mrd_unknown",
      actor: "local-operator:test",
      reason: "exchange-query-missing-after-downtime",
      resolvedAtMs: 1_704_067_200_000
    });
  });

  it("does not mutate local state when the exchange has the order", async () => {
    const store = {
      getOrderForUnknownResolution: vi.fn(async () => localUnknown),
      resolveUnknownOrderAsNotSent: vi.fn(async () => {})
    };
    const exchange = {
      getOrder: vi.fn(async () => ({
        clientOrderId: "mrd_unknown",
        symbol: "BTCUSDT",
        exchangeOrderId: "123",
        status: "NEW"
      }))
    };

    await expect(
      runUnknownOrderResolution({
        clientOrderId: "mrd_unknown",
        actor: "local-operator:test",
        reason: "manual-check",
        nowMs: () => 1_704_067_200_000,
        store,
        exchange
      })
    ).resolves.toEqual({
      outcome: "exchange-order-exists",
      clientOrderId: "mrd_unknown",
      symbol: "BTCUSDT"
    });

    expect(store.resolveUnknownOrderAsNotSent).not.toHaveBeenCalled();
  });

  it("fails closed without mutation when the exchange query fails", async () => {
    const store = {
      getOrderForUnknownResolution: vi.fn(async () => localUnknown),
      resolveUnknownOrderAsNotSent: vi.fn(async () => {})
    };
    const exchange = {
      getOrder: vi.fn(async () => {
        throw new Error("exchange unavailable");
      })
    };

    await expect(
      runUnknownOrderResolution({
        clientOrderId: "mrd_unknown",
        actor: "local-operator:test",
        reason: "manual-check",
        nowMs: () => 1_704_067_200_000,
        store,
        exchange
      })
    ).rejects.toThrow("exchange unavailable");

    expect(store.resolveUnknownOrderAsNotSent).not.toHaveBeenCalled();
  });

  it("rejects local orders that are not exactly unresolved UNKNOWN records", async () => {
    const store = {
      getOrderForUnknownResolution: vi.fn(async () => ({
        ...localUnknown,
        state: "NEW" as const
      })),
      resolveUnknownOrderAsNotSent: vi.fn(async () => {})
    };
    const exchange = {
      getOrder: vi.fn(async () => null)
    };

    await expect(
      runUnknownOrderResolution({
        clientOrderId: "mrd_unknown",
        actor: "local-operator:test",
        reason: "manual-check",
        nowMs: () => 1_704_067_200_000,
        store,
        exchange
      })
    ).rejects.toThrow("Order is not an unresolved UNKNOWN submission");

    expect(exchange.getOrder).not.toHaveBeenCalled();
    expect(store.resolveUnknownOrderAsNotSent).not.toHaveBeenCalled();
  });
});
