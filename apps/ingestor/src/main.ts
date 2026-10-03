import { BinanceRestClient } from "@meridian/binance-client";
import { createLogger, createMetricsRegistry } from "@meridian/observability";
import { pathToFileURL } from "node:url";
import { runKlineBackfillCommand } from "./backfill/kline-backfill-command.js";
import { createKlineBackfillService } from "./backfill/kline-backfill-service.js";
import { createIngestorApp } from "./runtime/app-bootstrap.js";
import { createMain } from "./runtime/main-entry.js";
import {
  runIngestorMain,
  type IngestorMainResult
} from "./runtime/main-runner.js";
import { loadIngestorConfig } from "./runtime/config.js";
import { createRuntimeClients } from "./runtime/runtime-clients.js";

const logger = createLogger("ingestor");

export async function runCliMain(
  argv: readonly string[] = process.argv
): Promise<IngestorMainResult> {
  const config = loadIngestorConfig();
  const clients = createRuntimeClients(config);
  const metricsRegistry = createMetricsRegistry("ingestor");
  const binance = new BinanceRestClient();

  try {
    await clients.redis.connect();

    const app = createIngestorApp({
      redis: clients.redis,
      postgres: clients.postgres,
      metricsRegistry
    });
    const backfillService = createKlineBackfillService({
      binance,
      postgres: clients.postgres
    });
    const main = createMain({
      run(args) {
        return runIngestorMain(args, {
          async runLive() {
            const migrations = await app.start();

            logger.info(
              { migrations },
              "ingestor live startup completed"
            );

            return { kind: "live-started" };
          },

          async runBackfillKlines(args) {
            await app.start();

            return runKlineBackfillCommand(args, {
              service: backfillService
            });
          }
        });
      }
    });

    return await main(argv);
  } finally {
    await clients.close();
  }
}

function isEntrypoint(): boolean {
  return process.argv[1] !== undefined &&
    pathToFileURL(process.argv[1]).href === import.meta.url;
}

if (isEntrypoint()) {
  runCliMain()
    .then((result) => {
      logger.info({ result }, "ingestor command completed");
    })
    .catch((error: unknown) => {
      logger.error({ err: error }, "ingestor command failed");
      process.exitCode = 1;
    });
}
