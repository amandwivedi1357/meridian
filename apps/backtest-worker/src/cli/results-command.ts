import {
  createBacktestResultReader,
  type BacktestResultReaderDeps,
  type SavedBacktestRunReport
} from "../results/backtest-result-reader.js";

export type BacktestResultsCliArgs =
  | { readonly command: "list"; readonly limit: number }
  | { readonly command: "show"; readonly runId: string };

export function parseBacktestResultsArgs(args: readonly string[]): BacktestResultsCliArgs {
  const command = args[0];
  if (command === "list") {
    return { command, limit: parseLimit(args.slice(1)) };
  }
  if (command === "show") {
    return { command, runId: parseRunId(args.slice(1)) };
  }
  throw new Error("Expected backtest results command: list or show");
}

export async function runBacktestResultsCommand(
  args: readonly string[],
  deps: BacktestResultReaderDeps
) {
  const parsed = parseBacktestResultsArgs(args);
  const reader = createBacktestResultReader(deps);

  if (parsed.command === "list") {
    const runs = await reader.listRecent(parsed.limit);
    return {
      runs: runs.map((run) => ({
        runId: run.runId,
        strategy: run.strategy,
        symbol: run.symbol,
        interval: run.interval,
        from: new Date(run.fromMs).toISOString(),
        to: new Date(run.toMs).toISOString(),
        createdAt: run.createdAt,
        totalReturnPct: run.metrics.totalReturnPct,
        tradeCount: run.metrics.tradeCount
      }))
    };
  }

  return summarizeReport(await reader.getReport(parsed.runId));
}

function parseLimit(args: readonly string[]): number {
  if (args.length === 0) return 20;
  if (args.length !== 2 || args[0] !== "--limit") {
    throw new Error("Usage: backtest list [--limit 20]");
  }
  const limit = Number(args[1]);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Backtest run list limit must be between 1 and 100");
  }
  return limit;
}

function parseRunId(args: readonly string[]): string {
  if (args.length !== 2 || args[0] !== "--run-id" || args[1] === undefined || args[1].trim() === "") {
    throw new Error("Usage: backtest show --run-id <id>");
  }
  return args[1];
}

function summarizeReport(report: SavedBacktestRunReport) {
  const firstEquity = report.equityCurve[0];
  const lastEquity = report.equityCurve[report.equityCurve.length - 1];

  return {
    runId: report.runId,
    strategy: report.strategy,
    symbol: report.symbol,
    interval: report.interval,
    from: new Date(report.fromMs).toISOString(),
    to: new Date(report.toMs).toISOString(),
    createdAt: report.createdAt,
    params: report.params,
    metrics: report.metrics,
    fillCount: report.fills.length,
    equityPointCount: report.equityCurve.length,
    ...(firstEquity === undefined
      ? {}
      : {
          firstEquity: {
            ts: new Date(firstEquity.tsMs).toISOString(),
            equity: firstEquity.equity
          }
        }),
    ...(lastEquity === undefined
      ? {}
      : {
          lastEquity: {
            ts: new Date(lastEquity.tsMs).toISOString(),
            equity: lastEquity.equity
          }
        }),
    fills: report.fills
  };
}
