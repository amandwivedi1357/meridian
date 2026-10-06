import WebSocket from "ws";
import { z } from "zod";
import type { BinanceEnvironment } from "../constants.js";
import type { RequestSigner } from "../rest/signing.js";
import { parseUserDataEvent, type UserDataEvent } from "./user-data-events.js";

export type UserDataStreamState =
  "IDLE" | "CONNECTING" | "SUBSCRIBING" | "OPEN" | "BACKOFF" | "FAILED" | "CLOSED";
export interface UserDataSocket {
  on(
    event: "open" | "close" | "error" | "message" | "pong",
    listener: (...args: unknown[]) => void
  ): unknown;
  send(data: string): void;
  ping(): void;
  terminate(): void;
}
export interface UserDataStreamOptions {
  readonly apiKey: string;
  readonly signer: RequestSigner;
  readonly now: () => number;
  readonly prepare: () => Promise<void>;
  readonly acquire: (weight: number) => Promise<void>;
  readonly environment?: BinanceEnvironment;
  readonly recvWindowMs?: number;
  readonly createWebSocket?: (url: string) => UserDataSocket;
  readonly timeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatTimeoutMs?: number;
  readonly reconnectBaseDelayMs?: number;
  readonly reconnectMaxDelayMs?: number;
  readonly rotationIntervalMs?: number;
  readonly random?: () => number;
}

const subscriptionReply = z.object({
  id: z.string(),
  status: z.number().int(),
  result: z.object({ subscriptionId: z.number().int().safe().nonnegative() }).optional()
});
const eventHeader = z.object({
  subscriptionId: z.number().int().safe().nonnegative().optional(),
  event: z.object({ e: z.string(), E: z.number().int().safe().nonnegative() })
});

export function createTestnetUserDataStream(options: UserDataStreamOptions) {
  if ((options.environment ?? "testnet") !== "testnet")
    throw new Error("User-data stream supports Testnet only");
  if (!/^[A-Za-z0-9_-]+$/.test(options.apiKey)) throw new Error("Invalid user-data API key");
  const timeoutMs = options.timeoutMs ?? 10_000;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 20_000;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 10_000;
  const reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 250;
  const reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 30_000;
  const rotationIntervalMs = options.rotationIntervalMs ?? 23 * 60 * 60 * 1_000;
  const recvWindow = options.recvWindowMs ?? 5_000;
  for (const value of [
    timeoutMs,
    heartbeatIntervalMs,
    heartbeatTimeoutMs,
    reconnectBaseDelayMs,
    reconnectMaxDelayMs,
    rotationIntervalMs
  ]) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647)
      throw new Error("Invalid user-data timing option");
  }
  if (heartbeatTimeoutMs >= heartbeatIntervalMs || reconnectBaseDelayMs > reconnectMaxDelayMs) {
    throw new Error("Invalid user-data timing relationship");
  }
  if (!Number.isSafeInteger(recvWindow) || recvWindow <= 0 || recvWindow > 60_000)
    throw new Error("Invalid recvWindow");
  const createSocket =
    options.createWebSocket ??
    ((url: string) =>
      new WebSocket(url, {
        followRedirects: false,
        handshakeTimeout: timeoutMs,
        maxPayload: 1_048_576,
        autoPong: true
      }));
  const random = options.random ?? Math.random;
  const events = new Set<(event: UserDataEvent) => void>();
  const states = new Set<(state: UserDataStreamState) => void>();
  const errors = new Set<(reason: string) => void>();
  let state: UserDataStreamState = "IDLE";
  let running = false;
  let generation = 0;
  let attempt = 0;
  let reconnectCount = 0;
  let socket: UserDataSocket | undefined;
  let subscriptionId: number | undefined;
  let requestId: string | undefined;
  let deadline: NodeJS.Timeout | undefined;
  let heartbeat: NodeJS.Timeout | undefined;
  let pongDeadline: NodeJS.Timeout | undefined;
  let rotation: NodeJS.Timeout | undefined;
  let reconnect: NodeJS.Timeout | undefined;

  function notify<T>(listeners: Set<(value: T) => void>, value: T): void {
    for (const listener of listeners) {
      try {
        listener(value);
      } catch {
        /* Consumer errors must not corrupt socket lifecycle. */
      }
    }
  }
  function transition(next: UserDataStreamState): void {
    if (state !== next) {
      state = next;
      notify(states, next);
    }
  }
  function cleanup(): void {
    clearTimeout(deadline);
    clearInterval(heartbeat);
    clearTimeout(pongDeadline);
    clearTimeout(rotation);
    clearTimeout(reconnect);
    deadline = heartbeat = pongDeadline = rotation = reconnect = undefined;
    const previous = socket;
    socket = undefined;
    subscriptionId = undefined;
    requestId = undefined;
    try {
      previous?.terminate();
    } catch {
      /* Socket is already detached. */
    }
  }
  function fail(reason: string, terminal = false): void {
    if (!running) return;
    generation += 1;
    cleanup();
    notify(errors, reason);
    if (!running) return;
    if (terminal) {
      running = false;
      transition("FAILED");
      return;
    }
    transition("BACKOFF");
    if (!running) return;
    reconnectCount += 1;
    const cap = Math.min(reconnectMaxDelayMs, reconnectBaseDelayMs * 2 ** Math.min(attempt++, 16));
    const jitter = random();
    const delay = Math.ceil(
      cap * (0.5 + (Number.isFinite(jitter) && jitter >= 0 && jitter <= 1 ? jitter : 0.5) / 2)
    );
    reconnect = setTimeout(() => {
      reconnect = undefined;
      void connect();
    }, delay);
  }
  async function connect(): Promise<void> {
    const current = ++generation;
    transition("CONNECTING");
    if (!running || generation !== current) return;
    deadline = setTimeout(() => fail("User-data connection timed out"), timeoutMs);
    try {
      await options.prepare();
      if (!running || generation !== current) return;
      await options.acquire(2);
      if (!running || generation !== current) return;
      const connection = createSocket("wss://ws-api.testnet.binance.vision/ws-api/v3");
      socket = connection;
      const active = () => running && generation === current && socket === connection;
      connection.on("error", () => {
        if (active()) fail("User-data socket error");
      });
      connection.on("close", () => {
        if (active()) fail("User-data socket closed; reconciliation required");
      });
      connection.on("pong", () => {
        if (active()) {
          clearTimeout(pongDeadline);
          pongDeadline = undefined;
        }
      });
      connection.on("open", () => {
        if (active()) void subscribe(connection, current);
      });
      connection.on("message", (raw, binary) => {
        if (!active()) return;
        try {
          if (binary === true || (!Buffer.isBuffer(raw) && typeof raw !== "string"))
            throw new Error("Invalid frame");
          handleMessage(JSON.parse(raw.toString()) as unknown);
        } catch {
          fail("Invalid user-data message; reconciliation required");
        }
      });
    } catch {
      if (running && generation === current) fail("User-data connection preparation failed");
    }
  }
  async function subscribe(connection: UserDataSocket, current: number): Promise<void> {
    transition("SUBSCRIBING");
    if (!running || generation !== current) return;
    try {
      await options.acquire(2);
      if (!running || generation !== current || socket !== connection) return;
      const timestamp = options.now();
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error("Invalid timestamp");
      requestId = `user-data-${current}`;
      const params = { apiKey: options.apiKey, recvWindow, timestamp };
      // WebSocket API signs alphabetically sorted raw values, unlike REST encoding.
      const payload = `apiKey=${params.apiKey}&recvWindow=${params.recvWindow}&timestamp=${params.timestamp}`;
      connection.send(
        JSON.stringify({
          id: requestId,
          method: "userDataStream.subscribe.signature",
          params: { ...params, signature: options.signer.sign(payload) }
        })
      );
    } catch {
      if (running && generation === current) fail("User-data subscription failed");
    }
  }
  function handleMessage(value: unknown): void {
    const reply = subscriptionReply.safeParse(value);
    if (reply.success && reply.data.id !== requestId) return;
    if (reply.success && reply.data.id === requestId) {
      if (state !== "SUBSCRIBING") return;
      if (reply.data.status !== 200 || reply.data.result === undefined) {
        fail(
          "User-data subscription rejected",
          reply.data.status >= 400 && reply.data.status < 500
        );
        return;
      }
      subscriptionId = reply.data.result.subscriptionId;
      clearTimeout(deadline);
      deadline = undefined;
      attempt = 0;
      transition("OPEN");
      if (!running || socket === undefined) return;
      heartbeat = setInterval(() => {
        const connection = socket;
        if (state !== "OPEN" || connection === undefined || pongDeadline !== undefined) return;
        pongDeadline = setTimeout(
          () => fail("User-data heartbeat timed out; reconciliation required"),
          heartbeatTimeoutMs
        );
        try {
          connection.ping();
        } catch {
          fail("User-data heartbeat failed");
        }
      }, heartbeatIntervalMs);
      rotation = setTimeout(
        () => fail("User-data session rotation; reconciliation required"),
        rotationIntervalMs
      );
      return;
    }
    const header = eventHeader.safeParse(value);
    if (!header.success) throw new Error("Invalid event envelope");
    if (header.data.event.e === "serverShutdown") {
      fail("User-data server shutdown; reconciliation required");
      return;
    }
    if (state !== "OPEN") return;
    if (header.data.subscriptionId !== subscriptionId) return;
    if (header.data.event.e === "eventStreamTerminated") {
      fail("User-data subscription terminated; reconciliation required");
      return;
    }
    const event = parseUserDataEvent(value);
    if (event !== undefined) {
      for (const listener of events) {
        try {
          listener(event);
        } catch {
          fail("User-data consumer failed; reconciliation required");
          break;
        }
      }
    }
  }
  function listen<T>(listeners: Set<(value: T) => void>, handler: (value: T) => void): () => void {
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }
  return {
    start(): void {
      if (running) return;
      running = true;
      attempt = 0;
      void connect();
    },
    close(): void {
      running = false;
      generation += 1;
      cleanup();
      transition("CLOSED");
    },
    getState: () => state,
    getSubscriptionId: () => subscriptionId,
    getReconnectCount: () => reconnectCount,
    onEvent: (handler: (event: UserDataEvent) => void) => listen(events, handler),
    onStateChange: (handler: (state: UserDataStreamState) => void) => listen(states, handler),
    onError: (handler: (reason: string) => void) => listen(errors, handler)
  };
}
