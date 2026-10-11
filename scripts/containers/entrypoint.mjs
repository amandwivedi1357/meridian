import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { URL } from "node:url";

const service = JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).name;
if (
  ["@meridian/engine", "@meridian/executor"].includes(service) &&
  (process.env.MERIDIAN_ENABLE_TRADING !== "testnet-confirmed" ||
    process.env.BINANCE_ENV !== "testnet")
) {
  console.error("Trading container blocked: explicit Testnet confirmation required");
  process.exit(78);
}
const file = service === "@meridian/ingestor" ? "dist/dashboard-feed.js" : "dist/main.js";
const child = spawn(process.execPath, [file, ...process.argv.slice(2)], { stdio: "inherit" });
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", () => {
  console.error("Container service could not start");
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  // A signal-killed child is not a clean drain; preserve that distinction.
  process.exitCode = code ?? (signal === "SIGTERM" ? 143 : signal === "SIGINT" ? 130 : 1);
});
