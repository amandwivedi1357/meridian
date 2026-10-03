import WebSocket from "ws";
import type { BinanceEnvironment } from "../constants.js";
import { BINANCE_STREAM_BASE_URLS } from "./constants.js";
import type {
  StreamConnectionEvent,
  StreamConnectionState,
  StreamMessage,
  StreamSubscription
} from "./stream-types.js";

export type StreamConnectionEventHandler = (event: StreamConnectionEvent) => void;
export type StreamMessageHandler = (message: StreamMessage) => void;
export interface StreamConnectionManagerOptions {
  readonly subscriptions: readonly StreamSubscription[];
  readonly now?: () => number;
  readonly environment?: BinanceEnvironment;
  readonly createWebSocket?: (url: string) => WebSocket;
  readonly staleTimeoutMs?: number;
  readonly staleCheckIntervalMs?: number;
  readonly reconnectBaseDelayMs?: number;
  readonly reconnectMaxDelayMs?: number;
  readonly random?: () => number;
  readonly rotationIntervalMs?: number;
}

export interface StreamConnectionManager {
  connect(): void;
  close(): void;
  checkStale(): void;
  calculateReconnectDelayForAttempt(attempt: number): number;
  getLastPingAtMs(): number | undefined;
  getLastPongAtMs(): number | undefined;
  getState(): StreamConnectionState;
  getSubscriptions(): readonly StreamSubscription[];
  onMessage(handler: StreamMessageHandler): () => void;
  onStateChange(handler: StreamConnectionEventHandler): () => void;
  transitionTo(state: StreamConnectionState, reason?: string): void;
  getLastMessageAtMs(): number | undefined;
  getLastMessageAgeMs(): number | undefined;
  getReconnectCount(): number;
}

export function createStreamConnectionManager(
  options: StreamConnectionManagerOptions
): StreamConnectionManager {
  const baseUrl = BINANCE_STREAM_BASE_URLS[options.environment ?? "production"];
  const listeners = new Set<StreamConnectionEventHandler>();
  const messageListeners = new Set<StreamMessageHandler>();
  const createWebSocket = options.createWebSocket ?? ((url: string) => new WebSocket(url));
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 250;
  const reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 30_000;
  const staleCheckIntervalMs = options.staleCheckIntervalMs ?? 5_000;
  const staleTimeoutMs = options.staleTimeoutMs ?? 30_000;
  const subscriptions = options.subscriptions;
  const rotationIntervalMs = options.rotationIntervalMs ?? 23 * 60 * 60 * 1000;

  let lastMessageAtMs: number | undefined;
  let lastPingAtMs: number | undefined;
  let lastPongAtMs: number | undefined;
  let reconnectAttempt = 0;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let rotatingSocket: WebSocket | undefined;
  let shouldReconnect = false;
  let socket: WebSocket | undefined;
  let staleTimer: NodeJS.Timeout | undefined;
  let state: StreamConnectionState = "IDLE";
  let reconnectCount = 0;
  let rotationTimer: NodeJS.Timeout | undefined;
  function getState(): StreamConnectionState {
    return state;
  }

  function getSubscriptions(): readonly StreamSubscription[] {
    return subscriptions;
  }

  function getLastPingAtMs(): number | undefined {
    return lastPingAtMs;
  }

  function getLastPongAtMs(): number | undefined {
    return lastPongAtMs;
  }
  function getLastMessageAtMs(): number | undefined {
    return lastMessageAtMs;
  }

  function getLastMessageAgeMs(): number | undefined {
    return lastMessageAtMs === undefined ? undefined : now() - lastMessageAtMs;
  }

  function getReconnectCount(): number {
    return reconnectCount;
  }
  function buildStreamUrl(): string {
    const streamNames = subscriptions.map((subscription) => subscription.streamName).join("/");

    return `${baseUrl}/stream?streams=${streamNames}`;
  }

  function onStateChange(handler: StreamConnectionEventHandler): () => void {
    listeners.add(handler);

    return () => {
      listeners.delete(handler);
    };
  }

  function onMessage(handler: StreamMessageHandler): () => void {
    messageListeners.add(handler);

    return () => {
      messageListeners.delete(handler);
    };
  }

  function transitionTo(nextState: StreamConnectionState, reason?: string): void {
    if (nextState === "OPEN") {
      lastMessageAtMs = now();
    }

    if (state === nextState) {
      return;
    }

    state = nextState;
    emit({
      state: nextState,
      timestampMs: now(),
      ...(reason !== undefined ? { reason } : {})
    });
  }

  function emit(event: StreamConnectionEvent): void {
    for (const listener of listeners) {
      listener(event);
    }
  }

  function emitMessage(message: StreamMessage): void {
    for (const listener of messageListeners) {
      listener(message);
    }
  }

  function connect(): void {
    if (state !== "IDLE" && state !== "BACKOFF") {
      return;
    }

    transitionTo("CONNECTING", "connect requested");
    shouldReconnect = true;

    socket = createWebSocket(buildStreamUrl());
    attachSocketHandlers(socket);
  }

  function attachSocketHandlers(connection: WebSocket): void {
    connection.on("ping", () => {
      if (connection !== socket) {
        return;
      }

      lastPingAtMs = now();
    });

    connection.on("pong", () => {
      if (connection !== socket) {
        return;
      }

      lastPongAtMs = now();
    });

    connection.on("open", () => {
      if (connection === rotatingSocket) {
        promoteRotatingSocket(connection);
        return;
      }

      transitionTo("OPEN", "socket opened");
      startRotationTimer();
      lastMessageAtMs = now();
      startStaleTimer();
      reconnectAttempt = 0;
    });

    connection.on("close", () => {
      if (connection !== socket) {
        if (connection === rotatingSocket) {
          rotatingSocket = undefined;
        }

        return;
      }

      socket = undefined;
      transitionTo("BACKOFF", "socket closed");

      if (shouldReconnect) {
        scheduleReconnect();
      }

      stopStaleTimer();
      stopRotationTimer();
      lastMessageAtMs = undefined;
      lastPingAtMs = undefined;
      lastPongAtMs = undefined;
    });

    connection.on("error", (error) => {
      if (connection !== socket) {
        if (connection === rotatingSocket) {
          rotatingSocket = undefined;
        }

        return;
      }

      stopStaleTimer();
      lastMessageAtMs = undefined;
      stopRotationTimer();
      transitionTo("BACKOFF", error.message);

      if (shouldReconnect) {
        scheduleReconnect();
      }

      lastPingAtMs = undefined;
      lastPongAtMs = undefined;
    });

    connection.on("message", (raw) => {
      if (state !== "OPEN" || connection !== socket) {
        return;
      }

      lastMessageAtMs = now();
      const message = JSON.parse(raw.toString()) as StreamMessage;
      emitMessage(message);
    });
  }

  function promoteRotatingSocket(nextSocket: WebSocket): void {
    const previousSocket = socket;

    socket = nextSocket;
    rotatingSocket = undefined;
    transitionTo("OPEN", "rotation socket opened");
    startRotationTimer();
    lastMessageAtMs = now();
    startStaleTimer();

    if (previousSocket !== undefined && previousSocket !== nextSocket) {
      previousSocket.close();
    }
  }

  function close(): void {
    if (!socket) {
      return;
    }

    transitionTo("CLOSING", "close requested");
    shouldReconnect = false;
    stopReconnectTimer();
    stopStaleTimer();
    lastPingAtMs = undefined;
    lastPongAtMs = undefined;
    stopRotationTimer();
    rotatingSocket?.close();
    rotatingSocket = undefined;
    socket.close();
  }

  function checkStale(): void {
    if (state !== "OPEN" || lastMessageAtMs === undefined) {
      return;
    }

    const ageMs = now() - lastMessageAtMs;

    if (ageMs >= staleTimeoutMs) {
      transitionTo("STALE", `no messages for ${ageMs}ms`);
      stopStaleTimer();
    }
  }

  function calculateReconnectDelayForAttempt(attempt: number): number {
    const exponentialDelay = Math.min(
      reconnectMaxDelayMs,
      reconnectBaseDelayMs * 2 ** Math.max(attempt - 1, 0)
    );

    return Math.ceil(random() * exponentialDelay);
  }

  function startStaleTimer(): void {
    stopStaleTimer();

    staleTimer = setInterval(() => {
      checkStale();
    }, staleCheckIntervalMs);
  }

  function stopStaleTimer(): void {
    if (staleTimer !== undefined) {
      clearInterval(staleTimer);
      staleTimer = undefined;
    }
  }

  function scheduleReconnect(): void {
    stopReconnectTimer();
    reconnectAttempt += 1;
    reconnectCount += 1;
    const delayMs = calculateReconnectDelayForAttempt(reconnectAttempt);

    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, delayMs);
  }

  function stopReconnectTimer(): void {
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
  }

  function startRotationTimer(): void {
    stopRotationTimer();

    rotationTimer = setTimeout(() => {
      if (state === "OPEN" && socket) {
        rotatingSocket = createWebSocket(buildStreamUrl());
        attachSocketHandlers(rotatingSocket);
      }
    }, rotationIntervalMs);
  }

  function stopRotationTimer(): void {
    if (rotationTimer !== undefined) {
      clearTimeout(rotationTimer);
      rotationTimer = undefined;
    }
  }

  return {
    calculateReconnectDelayForAttempt,
    checkStale,
    close,
    connect,
    getLastPingAtMs,
    getLastPongAtMs,
    getState,
    getSubscriptions,
    onMessage,
    onStateChange,
    transitionTo,
    getLastMessageAgeMs,
    getLastMessageAtMs,
    getReconnectCount
  };
}
