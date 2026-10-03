import { EventEmitter } from "node:events";
import type WebSocket from "ws";
import { describe, expect, it, vi } from "vitest";
import { createStreamConnectionManager } from "./connection-manager.js";

class FakeWebSocket extends EventEmitter {
  readonly close = vi.fn(() => {
    this.emit("close");
  });
}

describe("StreamConnectionManager", () => {
  it("starts idle and stores subscriptions", () => {
    const manager = createStreamConnectionManager({
      subscriptions: [{ streamName: "btcusdt@trade" }]
    });

    expect(manager.getState()).toBe("IDLE");
    expect(manager.getSubscriptions()).toEqual([{ streamName: "btcusdt@trade" }]);
  });

  it("emits state transition events", () => {
    const events: unknown[] = [];
    const manager = createStreamConnectionManager({
      subscriptions: [],
      now: () => 123
    });

    manager.onStateChange((event) => events.push(event));
    manager.transitionTo("CONNECTING", "manual start");

    expect(manager.getState()).toBe("CONNECTING");
    expect(events).toEqual([
      {
        state: "CONNECTING",
        reason: "manual start",
        timestampMs: 123
      }
    ]);
  });

  it("does not emit when transitioning to the same state", () => {
    const events: unknown[] = [];
    const manager = createStreamConnectionManager({
      subscriptions: [],
      now: () => 123
    });

    manager.onStateChange((event) => events.push(event));
    manager.transitionTo("IDLE", "already idle");

    expect(events).toEqual([]);
  });

  it("can unsubscribe listeners", () => {
    const events: unknown[] = [];
    const manager = createStreamConnectionManager({
      subscriptions: [],
      now: () => 123
    });

    const unsubscribe = manager.onStateChange((event) => events.push(event));
    unsubscribe();

    manager.transitionTo("CONNECTING");

    expect(events).toEqual([]);
  });
  it("marks an open connection stale when no messages arrive within the timeout", () => {
    let now = 1_000;
    const events: unknown[] = [];

    const manager = createStreamConnectionManager({
      subscriptions: [],
      now: () => now,
      staleTimeoutMs: 500
    });

    manager.onStateChange((event) => events.push(event));
    manager.transitionTo("OPEN", "test open");

    now = 1_600;
    manager.checkStale();

    expect(manager.getState()).toBe("STALE");
    expect(events).toEqual([
      {
        state: "OPEN",
        reason: "test open",
        timestampMs: 1000
      },
      {
        state: "STALE",
        reason: "no messages for 600ms",
        timestampMs: 1600
      }
    ]);
  });

  it("calculates reconnect delay with exponential full jitter", () => {
    const manager = createStreamConnectionManager({
      subscriptions: [],
      reconnectBaseDelayMs: 250,
      reconnectMaxDelayMs: 30_000,
      random: () => 1
    });

    expect(manager.calculateReconnectDelayForAttempt(1)).toBe(250);
    expect(manager.calculateReconnectDelayForAttempt(2)).toBe(500);
    expect(manager.calculateReconnectDelayForAttempt(3)).toBe(1000);
  });

  it("caps reconnect delay at the configured maximum", () => {
    const manager = createStreamConnectionManager({
      subscriptions: [],
      reconnectBaseDelayMs: 250,
      reconnectMaxDelayMs: 1_000,
      random: () => 1
    });

    expect(manager.calculateReconnectDelayForAttempt(10)).toBe(1000);
  });

  it("applies jitter to reconnect delay", () => {
    const manager = createStreamConnectionManager({
      subscriptions: [],
      reconnectBaseDelayMs: 250,
      reconnectMaxDelayMs: 30_000,
      random: () => 0.5
    });

    expect(manager.calculateReconnectDelayForAttempt(2)).toBe(250);
  });
  it("starts without heartbeat timestamps", () => {
    const manager = createStreamConnectionManager({
      subscriptions: []
    });

    expect(manager.getLastPingAtMs()).toBeUndefined();
    expect(manager.getLastPongAtMs()).toBeUndefined();
  });
    it("exposes last message age for metrics", () => {
    let now = 1_000;

    const manager = createStreamConnectionManager({
      subscriptions: [],
      now: () => now
    });

    expect(manager.getLastMessageAtMs()).toBeUndefined();
    expect(manager.getLastMessageAgeMs()).toBeUndefined();

    manager.transitionTo("OPEN", "test open");

    now = 1_250;

    expect(manager.getLastMessageAtMs()).toBe(1000);
    expect(manager.getLastMessageAgeMs()).toBe(250);
  });

  it("opens a replacement socket before closing the old socket during rotation", () => {
    vi.useFakeTimers();

    try {
      const sockets: FakeWebSocket[] = [];
      const manager = createStreamConnectionManager({
        subscriptions: [{ streamName: "btcusdt@trade" }],
        rotationIntervalMs: 1_000,
        createWebSocket: () => {
          const socket = new FakeWebSocket();
          sockets.push(socket);
          return socket as unknown as WebSocket;
        }
      });

      manager.connect();
      expect(sockets).toHaveLength(1);

      sockets[0]?.emit("open");
      expect(manager.getState()).toBe("OPEN");

      vi.advanceTimersByTime(1_000);

      expect(sockets).toHaveLength(2);
      expect(sockets[0]?.close).not.toHaveBeenCalled();

      sockets[1]?.emit("open");

      expect(sockets[0]?.close).toHaveBeenCalledTimes(1);
      expect(manager.getState()).toBe("OPEN");
    } finally {
      vi.useRealTimers();
    }
  });
});
