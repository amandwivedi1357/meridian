import { readFileSync } from "node:fs";
import { URL } from "node:url";

const service = JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).name;
const ports = {
  "@meridian/api": 9400,
  "@meridian/ingestor": 9401,
  "@meridian/engine": 9402,
  "@meridian/executor": 9403
};
const name = service.replace("@meridian/", "").toUpperCase();
const port = process.env[`${name}_DIAGNOSTICS_PORT`] ?? ports[service];
try {
  if (!port) throw new Error("This service has no readiness endpoint");
  const response = await globalThis.fetch(`http://127.0.0.1:${port}/health/ready`, {
    signal: globalThis.AbortSignal.timeout(2000)
  });
  process.exitCode = response.ok ? 0 : 1;
} catch {
  process.exitCode = 1;
}
