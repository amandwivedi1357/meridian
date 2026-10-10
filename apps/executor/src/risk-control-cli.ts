import { timingSafeEqual } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnvFile } from "node:process";
import { createTestnetTradingClientFromEnv, BinanceRestClient } from "@meridian/binance-client";
import { allocationFromEnv, projectTestnetAllocation } from "@meridian/core";
import { loadConfig } from "@meridian/config";
import {
  createRiskRepository,
  createTestnetAllocationRepository,
  testnetAccountBinding
} from "@meridian/db";
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
    (action !== "engage" && action !== "reset" && action !== "allocate") ||
    args.length !== 2 ||
    args[1] !==
      (action === "allocate" ? "--confirm-testnet-allocation" : "--confirm-testnet-control")
  ) {
    throw new Error(
      "Use engage|reset --confirm-testnet-control or allocate --confirm-testnet-allocation"
    );
  }
  try {
    loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  authorizeRiskControl();
  const allocation = allocationFromEnv(process.env);
  if (action === "allocate" && !allocation)
    throw new Error("MERIDIAN_TESTNET_ALLOCATION is required");
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
    const actor = `local-operator:${process.env.USERNAME ?? process.env.USER ?? "authenticated"}`;
    const allocationRepo = createTestnetAllocationRepository(clients.postgres);
    if (action === "allocate" && allocation) {
      const info = await new BinanceRestClient({ environment: "testnet" }).getExchangeInfo();
      const view = projectTestnetAllocation({
        policy: allocation,
        metadata: info.symbols,
        balances: await trading.getBalances(),
        openOrders: await trading.openOrders(),
        fills: [],
        managedOrders: []
      });
      await allocationRepo.initialize({
        database: clients.postgres,
        policy: allocation,
        accountBinding: testnetAccountBinding(process.env.BINANCE_API_KEY),
        actor,
        excludedWalletAssets: view.excludedWalletAssets,
        backingBaseline: view.backingTotals
      });
      logger.info(
        { policy: allocation, excludedWalletAssets: view.excludedWalletAssets },
        "Testnet allocation audited; kill switch remains engaged"
      );
      return;
    }
    // Emergency engagement must remain available even after configuration drift.
    if (action === "reset")
      await allocationRepo.assertPolicy(
        allocation,
        allocation ? testnetAccountBinding(process.env.BINANCE_API_KEY) : undefined
      );
    const persistedAllocation = await allocationRepo.policy();
    const kill = createKillSwitch({
      repo: createRiskRepository(clients.postgres),
      command: clients.redis.command,
      async listOpenOrders() {
        const orders = await trading!.openOrders();
        if (!persistedAllocation) return orders;
        const managed = new Map(
          (await allocationRepo.listManagedOrders()).map((order) => [
            order.clientOrderId,
            order.symbol
          ])
        );
        return orders.filter((order) => managed.get(order.clientOrderId) === order.symbol);
      },
      cancelOrder: trading.cancelOrder,
      alert(details) {
        logger.error(details, "kill-switch alert");
      }
    });
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
