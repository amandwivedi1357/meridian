import { EventEmitter } from "node:events";
import { generateKeyPairSync, verify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmacSigner, createEd25519Signer } from "../rest/signing.js";
import { createTestnetUserDataStream, type UserDataStreamOptions } from "./user-data-stream.js";

class FakeSocket extends EventEmitter {
  readonly send = vi.fn<(data: string) => void>();
  readonly ping = vi.fn(() => {});
  readonly terminate = vi.fn(() => {
    this.emit("close");
  });
}
const accountEvent = {
  subscriptionId: 0,
  event: { e: "outboundAccountPosition", E: 2_000, u: 1_999, B: [{ a: "BTC", f: "1", l: "0" }] }
};
function setup(overrides: Partial<UserDataStreamOptions> = {}) {
  const sockets: FakeSocket[] = [];
  const signer = createHmacSigner("test-only-secret");
  const createWebSocket = vi.fn<(url: string) => FakeSocket>(() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  });
  const prepare = vi.fn(async () => {});
  const acquire = vi.fn<(weight: number) => Promise<void>>(async () => {});
  const stream = createTestnetUserDataStream({
    apiKey: "test-key",
    signer,
    now: () => 2_000,
    prepare,
    acquire,
    createWebSocket,
    timeoutMs: 100,
    heartbeatIntervalMs: 200,
    heartbeatTimeoutMs: 50,
    reconnectBaseDelayMs: 20,
    reconnectMaxDelayMs: 100,
    rotationIntervalMs: 1_000,
    random: () => 1,
    ...overrides
  });
  async function connect() {
    stream.start();
    await vi.advanceTimersByTimeAsync(0);
    const socket = sockets.at(-1)!;
    socket.emit("open");
    await vi.advanceTimersByTimeAsync(0);
    const request = JSON.parse(socket.send.mock.calls[0]![0]) as {
      id: string;
      params: { apiKey: string; recvWindow: number; timestamp: number; signature: string };
      method: string;
    };
    return { socket, request };
  }
  async function open() {
    const result = await connect();
    result.socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({ id: result.request.id, status: 200, result: { subscriptionId: 0 } })
      ),
      false
    );
    return result;
  }
  return { stream, sockets, prepare, acquire, createWebSocket, signer, connect, open };
}

describe("Testnet user-data stream", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("is idle on construction and signs alphabetically sorted raw WebSocket parameters", async () => {
    const { stream, open, createWebSocket, signer, acquire } = setup();
    expect(stream.getState()).toBe("IDLE");
    expect(createWebSocket).not.toHaveBeenCalled();
    const { request } = await open();
    expect(createWebSocket).toHaveBeenCalledWith("wss://ws-api.testnet.binance.vision/ws-api/v3");
    expect(request.method).toBe("userDataStream.subscribe.signature");
    expect(request.params.signature).toBe(
      signer.sign("apiKey=test-key&recvWindow=5000&timestamp=2000")
    );
    expect(acquire.mock.calls).toEqual([[2], [2]]);
    expect(stream.getState()).toBe("OPEN");
    expect(stream.getSubscriptionId()).toBe(0);
    stream.close();
  });

  it("supports raw base64 Ed25519 subscription signatures", async () => {
    const keys = generateKeyPairSync("ed25519");
    const signer = createEd25519Signer(
      keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString()
    );
    const { stream, open } = setup({ signer });
    const { request } = await open();
    expect(
      verify(
        null,
        Buffer.from("apiKey=test-key&recvWindow=5000&timestamp=2000"),
        keys.publicKey,
        Buffer.from(request.params.signature, "base64")
      )
    ).toBe(true);
    stream.close();
  });

  it("delivers only events for the acknowledged subscription and supports unsubscribe listeners", async () => {
    const { stream, open } = setup();
    const handler = vi.fn();
    const remove = stream.onEvent(handler);
    const { socket } = await open();
    socket.emit("message", JSON.stringify({ ...accountEvent, subscriptionId: 99 }));
    expect(handler).not.toHaveBeenCalled();
    socket.emit("message", JSON.stringify(accountEvent));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: "account-update" }));
    remove();
    socket.emit("message", JSON.stringify(accountEvent));
    expect(handler).toHaveBeenCalledTimes(1);
    stream.close();
  });

  it("does not deliver account events before subscription acknowledgement", async () => {
    const { stream, connect } = setup();
    const handler = vi.fn();
    stream.onEvent(handler);
    const { socket } = await connect();
    socket.emit("message", JSON.stringify(accountEvent));
    expect(handler).not.toHaveBeenCalled();
    expect(stream.getState()).toBe("SUBSCRIBING");
    stream.close();
  });

  it("reconnects, prepares fresh time, and resubscribes after a socket closes", async () => {
    const { stream, open, sockets, prepare } = setup();
    const { socket, request } = await open();
    socket.emit("close");
    expect(stream.getState()).toBe("BACKOFF");
    await vi.advanceTimersByTimeAsync(20);
    expect(sockets).toHaveLength(2);
    sockets[1]!.emit("open");
    await vi.advanceTimersByTimeAsync(0);
    const newRequest = JSON.parse(sockets[1]!.send.mock.calls[0]![0]) as { id: string };
    expect(newRequest.id).not.toBe(request.id);
    sockets[1]!.emit(
      "message",
      JSON.stringify({ id: newRequest.id, status: 200, result: { subscriptionId: 2 } })
    );
    expect(stream.getState()).toBe("OPEN");
    expect(stream.getSubscriptionId()).toBe(2);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(stream.getReconnectCount()).toBe(1);
    stream.close();
  });

  it("ignores messages and errors from a detached socket", async () => {
    const { stream, open } = setup();
    const handler = vi.fn();
    stream.onEvent(handler);
    const { socket } = await open();
    socket.emit("error", new Error("private secret"));
    socket.emit("message", JSON.stringify(accountEvent));
    socket.emit("error", new Error("another error"));
    expect(handler).not.toHaveBeenCalled();
    expect(stream.getReconnectCount()).toBe(1);
    stream.close();
  });

  it("keeps an idle account connection healthy with ping/pong rather than trade activity", async () => {
    const { stream, open } = setup();
    const { socket } = await open();
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(200);
      socket.emit("pong");
    }
    expect(socket.ping).toHaveBeenCalledTimes(3);
    expect(stream.getState()).toBe("OPEN");
    stream.close();
  });

  it("reconnects if heartbeat acknowledgement is missing", async () => {
    const { stream, open } = setup();
    await open();
    await vi.advanceTimersByTimeAsync(250);
    expect(stream.getState()).toBe("BACKOFF");
    expect(stream.getSubscriptionId()).toBeUndefined();
    stream.close();
  });

  it.each(["serverShutdown", "eventStreamTerminated"])("reconnects on %s", async (eventType) => {
    const { stream, open } = setup();
    const { socket } = await open();
    socket.emit(
      "message",
      JSON.stringify({ subscriptionId: 0, event: { e: eventType, E: 2_000 } })
    );
    expect(stream.getState()).toBe("BACKOFF");
    stream.close();
  });

  it("rotates sessions and reports that reconciliation is required", async () => {
    const { stream, open } = setup({ rotationIntervalMs: 150 });
    const errors = vi.fn();
    stream.onError(errors);
    await open();
    await vi.advanceTimersByTimeAsync(150);
    expect(stream.getState()).toBe("BACKOFF");
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("reconciliation required"));
    stream.close();
  });

  it("stops reconnecting on authentication rejection without exposing server messages", async () => {
    const { stream, connect, sockets } = setup();
    const errors = vi.fn();
    stream.onError(errors);
    const { socket, request } = await connect();
    socket.emit(
      "message",
      JSON.stringify({ id: request.id, status: 401, error: { msg: "private secret" } })
    );
    expect(stream.getState()).toBe("FAILED");
    expect(errors).toHaveBeenCalledWith("User-data subscription rejected");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries transient subscription failures", async () => {
    const { stream, connect } = setup();
    const { socket, request } = await connect();
    socket.emit("message", JSON.stringify({ id: request.id, status: 503 }));
    expect(stream.getState()).toBe("BACKOFF");
    stream.close();
  });

  it("times out unacknowledged subscriptions", async () => {
    const { stream, connect } = setup();
    await connect();
    await vi.advanceTimersByTimeAsync(100);
    expect(stream.getState()).toBe("BACKOFF");
    stream.close();
  });

  it.each([
    "not JSON",
    "{}",
    JSON.stringify({ subscriptionId: 0, event: { e: "executionReport", E: 2_000 } })
  ])("rejects malformed frames without crashing: %s", async (message) => {
    const { stream, open } = setup();
    const { socket } = await open();
    expect(() => socket.emit("message", message)).not.toThrow();
    expect(stream.getState()).toBe("BACKOFF");
    stream.close();
  });

  it("clears timers and prevents reconnection when closed during backoff", async () => {
    const { stream, open, sockets } = setup();
    const { socket } = await open();
    socket.emit("close");
    stream.close();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(stream.getState()).toBe("CLOSED");
  });

  it("does not create a socket after closing during asynchronous preparation", async () => {
    let finish!: () => void;
    const { stream, createWebSocket } = setup({
      prepare: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    });
    stream.start();
    stream.close();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(createWebSocket).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not leave timers if a state listener closes on OPEN", async () => {
    const { stream, open } = setup();
    stream.onStateChange((state) => {
      if (state === "OPEN") stream.close();
    });
    await open();
    expect(vi.getTimerCount()).toBe(0);
    expect(stream.getState()).toBe("CLOSED");
  });

  it("reports consumer errors and forces reconciliation", async () => {
    const { stream, open } = setup();
    const errors = vi.fn();
    stream.onError(errors);
    stream.onEvent(() => {
      throw new Error("private data");
    });
    const { socket } = await open();
    socket.emit("message", JSON.stringify(accountEvent));
    expect(errors).toHaveBeenCalledWith("User-data consumer failed; reconciliation required");
    expect(stream.getState()).toBe("BACKOFF");
    stream.close();
  });

  it("is idempotent on repeated starts", async () => {
    const { stream, open, sockets } = setup();
    await open();
    stream.start();
    stream.start();
    expect(sockets).toHaveLength(1);
    stream.close();
  });

  it("refuses production and invalid timer configuration", () => {
    expect(() => setup({ environment: "production" })).toThrow("Testnet only");
    expect(() => setup({ heartbeatTimeoutMs: 300 })).toThrow("relationship");
    expect(() => setup({ timeoutMs: 0 })).toThrow("timing");
    expect(() => setup({ recvWindowMs: 60_001 })).toThrow("recvWindow");
  });

  it("ignores unknown account event types and mismatched acknowledgement IDs", async () => {
    const { stream, connect } = setup();
    const { socket, request } = await connect();
    socket.emit(
      "message",
      JSON.stringify({ id: "unrelated", status: 200, result: { subscriptionId: 9 } })
    );
    expect(stream.getState()).toBe("SUBSCRIBING");
    socket.emit(
      "message",
      JSON.stringify({ id: request.id, status: 200, result: { subscriptionId: 0 } })
    );
    socket.emit(
      "message",
      JSON.stringify({ subscriptionId: 0, event: { e: "listStatus", E: 2_000 } })
    );
    expect(stream.getState()).toBe("OPEN");
    stream.close();
  });

  it("rejects unexpected binary frames", async () => {
    const { stream, open } = setup();
    const { socket } = await open();
    socket.emit("message", Buffer.from("{}"), true);
    expect(stream.getState()).toBe("BACKOFF");
    stream.close();
  });

  it("backs off on preparation failures without creating a socket", async () => {
    const { stream, createWebSocket } = setup({
      prepare: async () => {
        throw new Error("private detail");
      }
    });
    stream.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(stream.getState()).toBe("BACKOFF");
    expect(createWebSocket).not.toHaveBeenCalled();
    stream.close();
  });

  it("caps exponential reconnect delay on repeated failures", async () => {
    const prepare = vi.fn(async () => {
      throw new Error("offline");
    });
    const { stream } = setup({ prepare });
    stream.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(20 + 40 + 80 + 100);
    expect(prepare).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(99);
    expect(prepare).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(prepare).toHaveBeenCalledTimes(6);
    stream.close();
  });

  it("ignores subscription work finishing after close", async () => {
    let finish!: () => void;
    let calls = 0;
    const acquire = async () => {
      if (++calls === 2)
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
    };
    const { stream, sockets } = setup({ acquire });
    stream.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.emit("open");
    await vi.advanceTimersByTimeAsync(0);
    stream.close();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets[0]!.send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out a connection that never opens", async () => {
    const { stream } = setup();
    stream.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(stream.getState()).toBe("BACKOFF");
    stream.close();
  });

  it("does not issue work if closed by a CONNECTING state listener", async () => {
    const { stream, prepare } = setup();
    stream.onStateChange((state) => {
      if (state === "CONNECTING") stream.close();
    });
    stream.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(prepare).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
