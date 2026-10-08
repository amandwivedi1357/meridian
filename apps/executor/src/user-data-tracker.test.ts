import type {
  UserDataEvent,
  UserDataStreamState,
  UserDataOrderUpdate
} from "@meridian/binance-client";
import { Decimal } from "@meridian/core";
import { describe, expect, it, vi } from "vitest";
import { createExecutorUserDataTracker } from "./user-data-tracker.js";

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

function fixture() {
  let eventListener: (event: UserDataEvent) => void = () => {};
  const store = { recordOrderExecutionUpdate: vi.fn(async () => undefined) };
  let state: UserDataStreamState = "CLOSED";
  let listener: (value: UserDataStreamState) => void = () => {};
  const stream = {
    start: vi.fn(() => change("OPEN")),
    close: vi.fn(() => change("CLOSED")),
    getState: () => state,
    onEvent(handler: typeof eventListener) {
      eventListener = handler;
      return () => {
        eventListener = () => {};
      };
    },
    onStateChange(handler: typeof listener) {
      listener = handler;
      return () => {
        listener = () => {};
      };
    }
  };
  function change(value: UserDataStreamState) {
    state = value;
    listener(value);
  }
  const reconcile = vi.fn(async (): Promise<void> => {});
  const onError = vi.fn();
  const tracker = createExecutorUserDataTracker({
    stream,
    reconcile,
    onError,
    store
  });
  return {
    tracker,
    stream,
    change,
    reconcile,
    onError,
    store,
    emit: (event: UserDataEvent) => eventListener(event)
  };
}

describe("executor user-data readiness", () => {
  it("persists accepted updates before shutdown returns", async () => {
    const f = fixture();
    await f.tracker.start();
    f.emit(update());
    await f.tracker.close();
    expect(f.store.recordOrderExecutionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ clientOrderId: "mrd_order_1", state: "NEW" })
    );
  });

  it("blocks further execution when an event cannot be persisted", async () => {
    const f = fixture();
    await f.tracker.start();
    f.store.recordOrderExecutionUpdate.mockRejectedValue(new Error("write failed"));
    f.emit(update());
    await expect(f.tracker.assertReady()).rejects.toThrow("execution blocked");
    expect(f.onError).toHaveBeenCalledOnce();
    await f.tracker.close();
  });
  it("blocks before startup and reconciles every open before allowing execution", async () => {
    const f = fixture();
    await expect(f.tracker.assertReady()).rejects.toThrow("execution blocked");
    await f.tracker.start();
    await f.tracker.assertReady();
    expect(f.reconcile).toHaveBeenCalledTimes(1);
    f.change("CLOSED");
    await expect(f.tracker.assertReady()).rejects.toThrow("execution blocked");
    f.change("OPEN");
    await f.tracker.assertReady();
    expect(f.reconcile).toHaveBeenCalledTimes(2);
    await f.tracker.close();
    await expect(f.tracker.assertReady()).rejects.toThrow("execution blocked");
  });

  it("fails closed on reconciliation errors", async () => {
    const f = fixture();
    f.reconcile.mockRejectedValue(new Error("database unavailable"));
    await expect(f.tracker.start()).rejects.toThrow("database unavailable");
    await expect(f.tracker.assertReady()).rejects.toThrow("execution blocked");
    expect(f.onError).toHaveBeenCalledOnce();
    expect(f.stream.close).toHaveBeenCalledOnce();
    await f.tracker.close();
  });

  it("waits for reconnect reconciliation to finish", async () => {
    const f = fixture();
    await f.tracker.start();
    let release!: () => void;
    f.reconcile.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    f.change("OPEN");
    const ready = vi.fn();
    const waiting = f.tracker.assertReady().then(ready);
    await vi.waitFor(() => expect(f.reconcile).toHaveBeenCalledTimes(2));
    expect(ready).not.toHaveBeenCalled();
    release();
    await waiting;
    expect(ready).toHaveBeenCalledOnce();
    await f.tracker.close();
  });
});
