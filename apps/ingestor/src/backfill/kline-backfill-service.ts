import type { PostgresLikeClient } from "@meridian/db";
import {
  createBinanceKlineBackfillFetcher,
  type BinanceKlineClient
} from "../adapters/binance-backfill-adapter.js";
import { createPostgresMarketWriter } from "../adapters/postgres-market-writer-factory.js";
import {
  runKlineBackfill,
  type KlineBackfillResult
} from "./kline-backfill-runner.js";
import type { KlineBackfillPlanInput } from "./kline-backfill-planner.js";

export interface KlineBackfillServiceDeps {
  readonly binance: BinanceKlineClient;
  readonly postgres: PostgresLikeClient;
}

export interface KlineBackfillService {
  readonly run: (input: KlineBackfillPlanInput) => Promise<KlineBackfillResult>;
}

export function createKlineBackfillService(
  deps: KlineBackfillServiceDeps
): KlineBackfillService {
  const fetchKlines = createBinanceKlineBackfillFetcher(deps.binance);
  const writer = createPostgresMarketWriter(deps.postgres);

  return {
    run(input) {
      return runKlineBackfill(input, {
        fetchKlines,
        upsertKlines: writer.upsertKlines
      });
    }
  };
}
