import { dirname, join } from "node:path";
import {
  createBacktestResultReader,
  type BacktestResultReaderDeps
} from "../results/backtest-result-reader.js";
import { renderBacktestHtmlReport } from "../reports/backtest-html-report.js";

export interface BacktestReportCommandDeps extends BacktestResultReaderDeps {
  readonly mkdir: (path: string) => Promise<void>;
  readonly writeFile: (path: string, contents: string) => Promise<void>;
}

export interface BacktestReportCliArgs {
  readonly runId: string;
  readonly outputPath: string;
}

export function parseBacktestReportArgs(args: readonly string[]): BacktestReportCliArgs {
  let runId: string | undefined;
  let outputPath: string | undefined;

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag || !value || value.startsWith("--")) {
      throw new Error("Usage: backtest report --run-id <id> [--output reports/backtests/run.html]");
    }
    if (flag === "--run-id" && runId === undefined) {
      runId = value;
    } else if (flag === "--output" && outputPath === undefined) {
      outputPath = value;
    } else {
      throw new Error("Usage: backtest report --run-id <id> [--output reports/backtests/run.html]");
    }
  }

  if (runId === undefined || runId.trim() === "") {
    throw new Error("Usage: backtest report --run-id <id> [--output reports/backtests/run.html]");
  }

  return {
    runId,
    outputPath: outputPath ?? join("reports", "backtests", `${sanitizeFileStem(runId)}.html`)
  };
}

export async function runBacktestReportCommand(
  args: readonly string[],
  deps: BacktestReportCommandDeps
) {
  const parsed = parseBacktestReportArgs(args);
  const report = await createBacktestResultReader(deps).getReport(parsed.runId);
  const html = renderBacktestHtmlReport(report);

  await deps.mkdir(dirname(parsed.outputPath));
  await deps.writeFile(parsed.outputPath, html);

  return {
    runId: parsed.runId,
    outputPath: parsed.outputPath
  };
}

function sanitizeFileStem(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized === "" ? "backtest-report" : sanitized;
}
