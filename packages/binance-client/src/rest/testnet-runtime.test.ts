import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createTestnetTradingClientFromEnv } from "./testnet-runtime.js";

describe("Testnet credential runtime", () => {
  it("loads an explicit HMAC configuration without reading files or sending requests", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const readPrivateKey = vi.fn();
    const client = await createTestnetTradingClientFromEnv({
      env: { BINANCE_API_KEY: "test-key", BINANCE_API_SECRET: "test-secret" },
      fetch,
      readPrivateKey
    });
    expect(client.userData.getState()).toBe("IDLE");
    expect(fetch).not.toHaveBeenCalled();
    expect(readPrivateKey).not.toHaveBeenCalled();
    client.close();
  });

  it("loads Ed25519 PEM through the injected reader", async () => {
    const keys = generateKeyPairSync("ed25519");
    const pem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const readPrivateKey = vi.fn(async () => pem);
    const client = await createTestnetTradingClientFromEnv({
      env: {
        BINANCE_ENV: "testnet",
        BINANCE_API_KEY: "test-key",
        BINANCE_PRIVATE_KEY_PATH: "test-only.pem"
      },
      readPrivateKey
    });
    expect(readPrivateKey).toHaveBeenCalledWith("test-only.pem");
    expect(client.userData.getState()).toBe("IDLE");
    client.close();
  });

  it("rejects production before reading a key or making requests", async () => {
    const readPrivateKey = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      createTestnetTradingClientFromEnv({
        env: { BINANCE_ENV: "production" },
        readPrivateKey,
        fetch
      })
    ).rejects.toThrow("Testnet only");
    expect(readPrivateKey).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { BINANCE_API_KEY: "" },
    { BINANCE_API_KEY: " " },
    { BINANCE_API_KEY: "test-key", BINANCE_API_SECRET: "" },
    {
      BINANCE_API_KEY: "test-key",
      BINANCE_API_SECRET: "secret",
      BINANCE_PRIVATE_KEY_PATH: "key.pem"
    }
  ])("rejects missing or ambiguous credentials without echoing secrets %j", async (env) => {
    await expect(createTestnetTradingClientFromEnv({ env })).rejects.toThrow(
      /required|exactly one/
    );
  });

  it("sanitizes private-key read failures", async () => {
    const client = createTestnetTradingClientFromEnv({
      env: { BINANCE_API_KEY: "test-key", BINANCE_PRIVATE_KEY_PATH: "sensitive-path.pem" },
      readPrivateKey: async () => {
        throw new Error("private path and credentials");
      }
    });
    await expect(client).rejects.toThrow("Unable to load Testnet Ed25519 private key");
  });
});
