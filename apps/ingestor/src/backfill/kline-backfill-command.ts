import { parseKlineBackfillArgs } from "./kline-backfill-cli.js";
import type {
  KlineBackfillResult
} from "./kline-backfill-runner.js";
import type { KlineBackfillService } from "./kline-backfill-service.js";

export interface KlineBackfillCommandDeps {
  readonly service: KlineBackfillService;
}

export function runKlineBackfillCommand(
  args: readonly string[],
  deps: KlineBackfillCommandDeps
): Promise<KlineBackfillResult> {
  return deps.service.run(parseKlineBackfillArgs(args));
}