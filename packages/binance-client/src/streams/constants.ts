import type { BinanceEnvironment } from "../constants.js";

export const BINANCE_STREAM_BASE_URLS: Record<BinanceEnvironment, string> = {
  production: "wss://stream.binance.com:9443",
  testnet: "wss://stream.testnet.binance.vision"
};