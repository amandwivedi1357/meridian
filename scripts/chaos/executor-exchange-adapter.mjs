import WebSocket from "../../packages/binance-client/node_modules/ws/index.js";
import { createTestnetTradingClient } from "../../packages/binance-client/src/rest/testnet-trading-client.js";
import { createHmacSigner } from "../../packages/binance-client/src/rest/signing.js";
export * from "../../packages/binance-client/src/index.js";

// Build-time substitution used only by the isolated chaos bundle, never production.
export async function createTestnetTradingClientFromEnv(options) {
  return createTestnetTradingClient({
    ...options,
    apiKey: "fixture-only",
    environment: "testnet",
    signer: createHmacSigner("fixture-only-secret"),
    timeoutMs: 10000,
    userData: {
      createWebSocket: () => new WebSocket("ws://exchange:8082/ws-api/v3"),
      reconnectBaseDelayMs: 100,
      reconnectMaxDelayMs: 500
    }
  });
}
