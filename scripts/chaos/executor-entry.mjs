import { URL } from "node:url";
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(input);
  if (url.origin !== "https://testnet.binance.vision")
    throw new Error("Isolated Executor blocked unexpected network destination");
  return nativeFetch(`http://exchange:8082${url.pathname}${url.search}`, options);
};

// The bundled production module's entrypoint check starts runCliMain exactly once.
await import("../../apps/executor/src/main.js");
