/* global __dirname */
const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");
const { randomBytes } = require("node:crypto");
if (process.argv[2] !== "--confirm-btc-100-usdt")
  throw new Error("Explicit bounded Testnet profile confirmation required");
const file = path.resolve(__dirname, "../.env");
let source = fs.readFileSync(file, "utf8");
const env = parseEnv(source);
if ((env.BINANCE_ENV ?? "testnet") !== "testnet")
  throw new Error("Refusing production configuration");
const policy = {
  id: "manual-btc-100",
  quoteAsset: "USDT",
  initialQuote: "100",
  symbols: ["BTCUSDT"]
};
const ownGeneratedLine = `MERIDIAN_TESTNET_ALLOCATION=${JSON.stringify(JSON.stringify(policy))}`;
const fixesOwnQuoting = source.split(/\r?\n/).includes(ownGeneratedLine);
if (
  env.MERIDIAN_TESTNET_ALLOCATION &&
  !fixesOwnQuoting &&
  JSON.stringify(JSON.parse(env.MERIDIAN_TESTNET_ALLOCATION)) !== JSON.stringify(policy)
)
  throw new Error("Existing allocation must be reviewed, never overwritten");
const values = {
  BINANCE_ENV: "testnet",
  MERIDIAN_TESTNET_ALLOCATION: JSON.stringify(policy),
  EXECUTOR_ALLOWED_STRATEGIES: "manual",
  EXECUTOR_RISK_SYMBOLS: "BTCUSDT",
  EXECUTOR_MAX_NOTIONAL: "25",
  EXECUTOR_MAX_QUANTITY: "0.0002",
  EXECUTOR_MAX_OPEN_ORDERS: "1",
  EXECUTOR_MAX_GLOBAL_EXPOSURE: "100",
  EXECUTOR_MAX_SYMBOL_EXPOSURE: "100",
  EXECUTOR_SYMBOL_RISK_LIMITS: "{}",
  EXECUTOR_STRATEGY_RISK_LIMITS: "{}",
  MERIDIAN_RISK_ADMIN_TOKEN:
    env.MERIDIAN_RISK_ADMIN_TOKEN?.length >= 32
      ? env.MERIDIAN_RISK_ADMIN_TOKEN
      : randomBytes(32).toString("hex")
};
const newline = source.includes("\r\n") ? "\r\n" : "\n";
for (const [key, value] of Object.entries(values)) {
  const pattern = new RegExp(`^${key}=.*$`, "gm"),
    line = `${key}='${value}'`;
  if (pattern.test(source)) source = source.replace(pattern, () => line);
  else source += `${source.endsWith("\n") ? "" : newline}${line}${newline}`;
}
fs.writeFileSync(file, source);
console.log(
  "Bounded manual Testnet profile saved privately; no credentials printed. Kill switch unchanged."
);
