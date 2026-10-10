import { loadEnvFile } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createBinanceReconciliationExchange,
  createTestnetTradingClientFromEnv
} from "@meridian/binance-client";
import { loadConfig } from "@meridian/config";
import {
  createOrderWriteAheadRepository,
  marketDataMigrations,
  runMigrations
} from "@meridian/db";

import { runAccountTradeCatchUp, type AccountTradeCatchUpResult } from "./account-trade-catch-up.js";
import { createExecutorRuntimeClients } from "./runtime-clients.js";
import { runStartupReconciliation } from "./startup-reconciliation.js";

export async function runAccountTradeCatchUpSmoke(args = process.argv.slice(2)) {
  if (args.length !== 1 || args[0] !== "--confirm-read-only-account-trades") {
    throw new Error("Use --confirm-read-only-account-trades");
  }

  try {
    loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const config = loadConfig();
  const clients = createExecutorRuntimeClients({
    postgresUrl: config.DATABASE_URL,
    redisUrl: config.REDIS_URL
  });
  const trading = await createTestnetTradingClientFromEnv({ autoSynchronizeTime: true });
  let catchUpResult: AccountTradeCatchUpResult | undefined;

  try {
    await runMigrations(marketDataMigrations, {
      async execute(query) {
        await clients.postgres.execute(query);
      },
      async hasMigrationRun(id) {
        const result = await clients.postgres.execute({
          text: "SELECT id FROM schema_migrations WHERE id = $1",
          values: [id]
        });
        if (result.rows === undefined) throw new Error("Migration state unavailable");
        return result.rows.length > 0;
      }
    });

    const store = createOrderWriteAheadRepository(clients.postgres);
    const report = await runStartupReconciliation({
      store,
      exchange: createBinanceReconciliationExchange({ client: trading }),
      logger: {
        info() {},
        warn() {},
        error() {}
      },
      reason: "startup",
      async accountTradeCatchUp(reconciliationReport) {
        catchUpResult = await runAccountTradeCatchUp({
          report: reconciliationReport,
          accountTrades: { getAccountTrades: trading.getAccountTrades },
          store
        });
        return catchUpResult;
      }
    });

    return {
      environment: "testnet",
      mode: "read-only-account-trades",
      checked: report.checked,
      matched: report.matched.length,
      terminalOnExchange: report.terminalOnExchange.length,
      missingOnExchange: report.missingOnExchange.length,
      queryFailed: report.queryFailed.length,
      accountTradeCatchUp: catchUpResult ?? {
        ordersChecked: 0,
        tradesFetched: 0,
        fillsPersisted: 0
      }
    };
  } finally {
    await trading.close();
    await clients.close();
  }
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runAccountTradeCatchUpSmoke()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? (error.stack ?? error.message) : "Catch-up smoke failed"}\n`
      );
      process.exitCode = 1;
    });
}
