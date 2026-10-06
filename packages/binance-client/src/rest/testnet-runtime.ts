import { readFile } from "node:fs/promises";
import { createEd25519Signer, createHmacSigner } from "./signing.js";
import {
  createTestnetTradingClient,
  type TestnetTradingClientOptions
} from "./testnet-trading-client.js";

export interface TestnetRuntimeOptions extends Omit<
  TestnetTradingClientOptions,
  "apiKey" | "signer" | "environment"
> {
  readonly env?: NodeJS.ProcessEnv;
  readonly readPrivateKey?: (path: string) => Promise<string>;
}

export async function createTestnetTradingClientFromEnv(options: TestnetRuntimeOptions = {}) {
  const {
    env = process.env,
    readPrivateKey = (path) => readFile(path, "utf8"),
    ...clientOptions
  } = options;
  if ((env.BINANCE_ENV ?? "testnet") !== "testnet") {
    throw new Error("Trading runtime supports Testnet only");
  }
  const apiKey = env.BINANCE_API_KEY;
  if (apiKey === undefined || !/^[A-Za-z0-9_-]+$/.test(apiKey)) {
    throw new Error("Valid BINANCE_API_KEY is required for Testnet runtime");
  }
  const secret = env.BINANCE_API_SECRET;
  const keyPath = env.BINANCE_PRIVATE_KEY_PATH;
  const hasSecret = secret !== undefined && secret.trim() !== "";
  const hasKeyPath = keyPath !== undefined && keyPath.trim() !== "";
  if (hasSecret === hasKeyPath) {
    throw new Error("Configure exactly one of BINANCE_API_SECRET or BINANCE_PRIVATE_KEY_PATH");
  }
  let signer;
  if (hasSecret) {
    signer = createHmacSigner(secret);
  } else {
    let pem: string;
    try {
      pem = await readPrivateKey(keyPath!);
    } catch {
      throw new Error("Unable to load Testnet Ed25519 private key");
    }
    signer = createEd25519Signer(pem);
  }
  return createTestnetTradingClient({ ...clientOptions, apiKey, signer, environment: "testnet" });
}
