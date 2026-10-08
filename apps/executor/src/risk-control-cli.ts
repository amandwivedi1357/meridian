import { timingSafeEqual } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnvFile } from "node:process";
import { createTestnetTradingClientFromEnv } from "@meridian/binance-client";
import { loadConfig } from "@meridian/config";
import { createRiskRepository } from "@meridian/db";
import { createLogger } from "@meridian/observability";
import { createKillSwitch } from "./kill-switch.js";
import { createExecutorRuntimeClients } from "./runtime-clients.js";

export function authorizeRiskControl(env: NodeJS.ProcessEnv = process.env): void {
  const expected = env.MERIDIAN_RISK_ADMIN_TOKEN;
  const supplied = env.MERIDIAN_RISK_CONTROL_TOKEN;
  if (
    expected === undefined ||
    supplied === undefined ||
    expected.length < 32 ||
    Buffer.byteLength(expected) !== Buffer.byteLength(supplied) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
  )
    throw new Error("Risk control authentication failed");
}
export async function runRiskControl(args = process.argv.slice(2)) {
  const action = args[0];
  if (
    (action !== "engage" && action !== "reset") ||
    args.length !== 2 ||
    args[1] !== "--confirm-testnet-control"
  ) {
    throw new Error(
      "Use engage|reset --confirm-testnet-control; engage cancels Testnet open orders"
    );
  }
  try {
    loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  authorizeRiskControl();
  const config = loadConfig();
  const clients = createExecutorRuntimeClients({
    postgresUrl: config.DATABASE_URL,
    redisUrl: config.REDIS_URL
  });
  const logger = createLogger("risk-control");
  let trading: Awaited<ReturnType<typeof createTestnetTradingClientFromEnv>> | undefined;
  try {
    trading = await createTestnetTradingClientFromEnv({ autoSynchronizeTime: true });
    await clients.redis.connect();
    const kill = createKillSwitch({
      repo: createRiskRepository(clients.postgres),
      command: clients.redis.command,
      listOpenOrders: trading.openOrders,
      cancelOrder: trading.cancelOrder,
      alert(details) {
        logger.error(details, "kill-switch alert");
      }
    });
    const actor = `local-operator:${process.env.USERNAME ?? process.env.USER ?? "authenticated"}`;
    if (action === "reset") await kill.reset(actor, async () => authorizeRiskControl());
    else await kill.engage("explicit-operator-command", actor);
    logger.info({ action, actor }, "risk control applied");
  } finally {
    await trading?.close();
    await clients.close();
  }
}
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runRiskControl().catch(() => {
    process.stderr.write("Risk control failed; inspect risk state and configuration.\n");
    process.exitCode = 1;
  });
}
