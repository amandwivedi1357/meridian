export type BinanceEnvironment = "testnet" | "production";

export const BINANCE_REST_BASE_URLS: Record<BinanceEnvironment, string> = {
  testnet: "https://testnet.binance.vision",
  production: "https://api.binance.com"
};