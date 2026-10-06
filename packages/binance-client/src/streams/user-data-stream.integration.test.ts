import { once } from "node:events";
import type { AddressInfo } from "node:net";
import WebSocket, { WebSocketServer } from "ws";
import { expect, it } from "vitest";
import { createHmacSigner } from "../rest/signing.js";
import { createTestnetUserDataStream } from "./user-data-stream.js";
import type { UserDataEvent } from "./user-data-events.js";

it("subscribes and receives events over a real local socket with automatic server-ping replies", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const signer = createHmacSigner("test-only-secret");
  let signatureValid = false;
  let receivedPong = false;
  server.on("connection", (connection) => {
    connection.on("pong", (payload) => {
      receivedPong = payload.toString() === "heartbeat";
    });
    connection.on("message", (raw) => {
      const request = JSON.parse(raw.toString()) as { id: string; params: { signature: string } };
      signatureValid =
        request.params.signature === signer.sign("apiKey=test-key&recvWindow=5000&timestamp=2000");
      connection.send(
        JSON.stringify({ id: request.id, status: 200, result: { subscriptionId: 0 } })
      );
      connection.ping("heartbeat");
      connection.send(
        JSON.stringify({
          subscriptionId: 0,
          event: { e: "balanceUpdate", E: 2_000, T: 1_999, a: "BTC", d: "-0.001" }
        })
      );
    });
  });
  const stream = createTestnetUserDataStream({
    apiKey: "test-key",
    signer,
    now: () => 2_000,
    prepare: async () => {},
    acquire: async () => {},
    createWebSocket: () => new WebSocket(`ws://127.0.0.1:${address.port}`, { autoPong: true })
  });
  let timeout: NodeJS.Timeout | undefined;
  try {
    const received = new Promise<UserDataEvent>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("Local user-data integration timed out")), 3_000);
      stream.onEvent(resolve);
      stream.onError(() => reject(new Error("Local user-data integration failed")));
    });
    stream.start();
    const event = await received;
    expect(event.kind).toBe("balance-update");
    expect(signatureValid).toBe(true);
    await expect.poll(() => receivedPong).toBe(true);
    expect(stream.getState()).toBe("OPEN");
  } finally {
    clearTimeout(timeout);
    stream.close();
    for (const connection of server.clients) connection.terminate();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}, 5_000);
