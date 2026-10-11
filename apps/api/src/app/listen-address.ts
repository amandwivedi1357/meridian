import { isIP } from "node:net";

export function apiListenAddress(env: Record<string, string | undefined>) {
  const host = env.API_HOST ?? "127.0.0.1";
  const port = Number(env.API_PORT ?? "3000");
  if (!isIP(host)) throw new Error("API_HOST must be an IP address");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("API_PORT must be an integer from 1 to 65535");
  }
  return { host, port };
}
