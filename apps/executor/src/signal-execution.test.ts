import { serializeSignal, Decimal, type GatewayOrderResult, type Signal } from "@meridian/core";
import { describe, expect, it, vi } from "vitest";

import {
  executeSignal as executeWithoutDefaults,
  processSignalMessage as processWithoutDefaults
} from "./signal-execution.js";

const approvedRisk = { evaluate: async () => ({ approved: true as const }) };
function processSignalMessage(...args: Parameters<typeof processWithoutDefaults>) {
  return processWithoutDefaults(args[0], { riskGate: approvedRisk, ...args[1] });
}
function executeSignal(...args: Parameters<typeof executeWithoutDefaults>) {
  return executeWithoutDefaults(args[0], { riskGate: approvedRisk, ...args[1] });
}

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

function message(value: Signal) {
  return {
    id: "1-0",
    fields: {
      kind: "signal",
      signalId: value.signalId,
      payload: JSON.stringify(serializeSignal(value))
    }
  };
}

function orderResult(clientOrderId: string): GatewayOrderResult {
  return {
    clientOrderId,
    exchangeOrderId: "123",
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    status: "NEW",
    executedQuantity: new Decimal("0"),
    cumulativeQuoteQuantity: new Decimal("0"),
    fills: [],
    eventTimeMs: 1_500
  };
}

describe("signal execution", () => {
  it("persists rejection before ACK and leaves it pending if auditing fails", async () => {
    const bus = { xAck: vi.fn(async () => 1) };
    const recordRejection = vi.fn(async () => {
      expect(bus.xAck).not.toHaveBeenCalled();
    });
    const deps = {
      bus,
      group: "executor",
      recordRejection,
      store: { recordPendingOrder: vi.fn(), claimOrderSubmission: vi.fn() },
      exchange: { placeOrder: vi.fn() },
      clientOrderIdPrefix: "mrd",
      nowMs: () => 1500,
      riskGate: {
        evaluate: async () => ({ approved: false as const, reason: "kill-switch-engaged" })
      }
    };
    await processSignalMessage(message(signal()), deps);
    expect(recordRejection).toHaveBeenCalledWith({
      messageId: "1-0",
      signalId: "sig_1",
      reason: "kill-switch-engaged"
    });
    bus.xAck.mockClear();
    recordRejection.mockRejectedValue(new Error("audit DB unavailable"));
    await expect(processSignalMessage(message(signal()), deps)).rejects.toThrow(
      "audit DB unavailable"
    );
    expect(bus.xAck).not.toHaveBeenCalled();
    expect(deps.exchange.placeOrder).not.toHaveBeenCalled();
  });
  it("fails closed when a risk gate is not supplied", async () => {
    const recordPendingOrder = vi.fn();
    const placeOrder = vi.fn();
    const result = await executeWithoutDefaults(signal(), {
      store: { recordPendingOrder, claimOrderSubmission: vi.fn() },
      exchange: { placeOrder },
      clientOrderIdPrefix: "mrd",
      nowMs: () => 1500
    });
    expect(result).toMatchObject({ outcome: "rejected", reason: "risk-gate-unavailable" });
    expect(recordPendingOrder).not.toHaveBeenCalled();
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it.each(["risk", "persistence", "claim", "final-risk"])(
    "does not send a signal that expires during %s",
    async (stage) => {
      let now = 1500;
      const placeOrder = vi.fn();
      const metrics = { recordExpiredSignal: vi.fn() };
      const bus = { xAck: vi.fn(async () => 1) };
      const result = await processSignalMessage(message(signal()), {
        bus,
        group: "executor",
        metrics,
        async beforeSubmit() {
          if (stage === "final-risk") now = 2500;
        },
        store: {
          recordPendingOrder: async () => {
            if (stage === "persistence") now = 2500;
          },
          claimOrderSubmission: async () => {
            if (stage === "claim") now = 2500;
            return true;
          }
        },
        exchange: { placeOrder },
        clientOrderIdPrefix: "mrd",
        nowMs: () => now,
        riskGate: {
          evaluate: async () => {
            if (stage === "risk") now = 2500;
            return { approved: true };
          }
        }
      });
      expect(result.outcome).toBe("expired");
      expect(metrics.recordExpiredSignal).toHaveBeenCalledOnce();
      expect(placeOrder).not.toHaveBeenCalled();
      expect(bus.xAck).toHaveBeenCalledOnce();
    }
  );

  it("queries instead of resending after placement succeeds but Redis ACK fails", async () => {
    let claimed = false;
    let id = "";
    const placeOrder = vi.fn(async (request) => {
      id = request.clientOrderId;
      return orderResult(id);
    });
    const getOrder = vi.fn(async () => orderResult(id));
    const xAck = vi.fn(async () => 1).mockRejectedValueOnce(new Error("ack lost"));
    const deps = {
      bus: { xAck },
      group: "executor",
      store: {
        recordPendingOrder: vi.fn(async () => {}),
        claimOrderSubmission: async () => {
          if (claimed) return false;
          claimed = true;
          return true;
        }
      },
      exchange: { placeOrder, getOrder },
      clientOrderIdPrefix: "mrd",
      nowMs: () => 1500
    };
    await expect(processSignalMessage(message(signal()), deps)).rejects.toThrow("ack lost");
    await expect(processSignalMessage(message(signal()), deps)).resolves.toMatchObject({
      outcome: "submitted"
    });
    expect(placeOrder).toHaveBeenCalledOnce();
    expect(getOrder).toHaveBeenCalledWith({ symbol: "BTCUSDT", clientOrderId: id });
  });

  it("leaves an ambiguous recovered submission pending without a resend", async () => {
    const placeOrder = vi.fn();
    const xAck = vi.fn();
    await expect(
      processSignalMessage(message(signal()), {
        bus: { xAck },
        group: "executor",
        store: { recordPendingOrder: vi.fn(), claimOrderSubmission: async () => false },
        exchange: { placeOrder, getOrder: async () => null },
        clientOrderIdPrefix: "mrd",
        nowMs: () => 1500
      })
    ).rejects.toThrow("reconciliation required");
    expect(placeOrder).not.toHaveBeenCalled();
    expect(xAck).not.toHaveBeenCalled();
  });
  it("drops and acknowledges expired signal messages before order submission", async () => {
    const store = {
      claimOrderSubmission: vi.fn(async () => true),
      recordPendingOrder: vi.fn()
    };
    const exchange = {
      placeOrder: vi.fn()
    };
    const bus = {
      xAck: vi.fn(async () => 1)
    };
    const metrics = {
      recordExpiredSignal: vi.fn()
    };
    const expiredSignal = signal();

    const result = await processSignalMessage(message(expiredSignal), {
      bus,
      group: "executor",
      store,
      exchange,
      clientOrderIdPrefix: "mrd",
      nowMs: () => 2_001,
      metrics
    });

    expect(result).toEqual({ outcome: "expired", signalId: "sig_1" });
    expect(metrics.recordExpiredSignal).toHaveBeenCalledWith(expiredSignal);
    expect(store.recordPendingOrder).not.toHaveBeenCalled();
    expect(exchange.placeOrder).not.toHaveBeenCalled();
    expect(bus.xAck).toHaveBeenCalledWith("signals", "executor", "1-0");
  });

  it("records the pending order before sending a valid signal to the exchange", async () => {
    const events: string[] = [];
    const store = {
      claimOrderSubmission: vi.fn(async () => true),
      recordPendingOrder: vi.fn(async () => {
        events.push("record");
      })
    };
    const exchange = {
      placeOrder: vi.fn(async (request) => {
        events.push("place");
        return orderResult(request.clientOrderId);
      })
    };
    const bus = {
      xAck: vi.fn(async () => {
        events.push("ack");
        return 1;
      })
    };

    const result = await processSignalMessage(message(signal()), {
      bus,
      group: "executor",
      store,
      exchange,
      clientOrderIdPrefix: "mrd",
      nowMs: () => 1_500
    });

    expect(result).toMatchObject({
      outcome: "submitted",
      signalId: "sig_1"
    });
    expect(store.recordPendingOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        strategyId: "ema",
        signalId: "sig_1",
        attempt: 0,
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        quantity: "0.0002",
        limitPrice: "83000.91",
        createdAtMs: 1_500
      })
    );
    expect(exchange.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        quantity: new Decimal("0.0002"),
        price: new Decimal("83000.91"),
        timeInForce: "GTC"
      })
    );
    expect(events).toEqual(["record", "place", "ack"]);
  });

  it("acknowledges risk-rejected signals without recording or sending orders", async () => {
    const store = {
      claimOrderSubmission: vi.fn(async () => true),
      recordPendingOrder: vi.fn()
    };
    const exchange = {
      placeOrder: vi.fn()
    };
    const bus = {
      xAck: vi.fn(async () => 1)
    };

    const result = await processSignalMessage(message(signal()), {
      bus,
      group: "executor",
      store,
      exchange,
      clientOrderIdPrefix: "mrd",
      nowMs: () => 1_500,
      riskGate: {
        evaluate: vi.fn(async () => ({ approved: false, reason: "daily-loss-limit" }))
      }
    });

    expect(result).toEqual({
      outcome: "rejected",
      signalId: "sig_1",
      reason: "daily-loss-limit"
    });
    expect(store.recordPendingOrder).not.toHaveBeenCalled();
    expect(exchange.placeOrder).not.toHaveBeenCalled();
    expect(bus.xAck).toHaveBeenCalledWith("signals", "executor", "1-0");
  });

  it("does not record expiry metrics for risk-rejected fresh signals", async () => {
    const metrics = {
      recordExpiredSignal: vi.fn()
    };

    await processSignalMessage(message(signal()), {
      bus: {
        xAck: vi.fn(async () => 1)
      },
      group: "executor",
      store: {
        claimOrderSubmission: vi.fn(async () => true),
        recordPendingOrder: vi.fn()
      },
      exchange: {
        placeOrder: vi.fn()
      },
      clientOrderIdPrefix: "mrd",
      nowMs: () => 1_500,
      metrics,
      riskGate: {
        evaluate: vi.fn(async () => ({ approved: false, reason: "daily-loss-limit" }))
      }
    });

    expect(metrics.recordExpiredSignal).not.toHaveBeenCalled();
  });

  it("does not acknowledge messages when exchange submission fails", async () => {
    const error = new Error("exchange unavailable");
    const store = {
      claimOrderSubmission: vi.fn(async () => true),
      recordPendingOrder: vi.fn(async () => undefined)
    };
    const exchange = {
      placeOrder: vi.fn(async () => {
        throw error;
      })
    };
    const bus = {
      xAck: vi.fn(async () => 1)
    };

    await expect(
      processSignalMessage(message(signal()), {
        bus,
        group: "executor",
        store,
        exchange,
        clientOrderIdPrefix: "mrd",
        nowMs: () => 1_500
      })
    ).rejects.toBe(error);

    expect(store.recordPendingOrder).toHaveBeenCalledTimes(1);
    expect(bus.xAck).not.toHaveBeenCalled();
  });

  it("rejects unsupported order types before write-ahead persistence", async () => {
    const store = {
      claimOrderSubmission: vi.fn(async () => true),
      recordPendingOrder: vi.fn()
    };
    const exchange = {
      placeOrder: vi.fn()
    };

    const result = await executeSignal(
      signal({
        intent: {
          symbol: "BTCUSDT",
          side: "BUY",
          type: "STOP_MARKET",
          quantity: new Decimal("0.0002"),
          stopPrice: new Decimal("82000"),
          reason: "protective stop"
        }
      }),
      {
        store,
        exchange,
        clientOrderIdPrefix: "mrd",
        nowMs: () => 1_500
      }
    );

    expect(result).toEqual({
      outcome: "rejected",
      signalId: "sig_1",
      reason: "unsupported-order-type"
    });
    expect(store.recordPendingOrder).not.toHaveBeenCalled();
    expect(exchange.placeOrder).not.toHaveBeenCalled();
  });
});
