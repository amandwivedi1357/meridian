import type { CandleFeedRequest } from "../feeds/candle-feed.js";

export interface WalkForwardOptions {
  readonly request: CandleFeedRequest;
  readonly trainMs: number;
  readonly testMs: number;
  readonly stepMs?: number;
}

export interface WalkForwardWindow {
  readonly index: number;
  readonly train: CandleFeedRequest;
  readonly test: CandleFeedRequest;
}

export interface WalkForwardRunSummary {
  readonly totalReturnPct: string;
  readonly maxDrawdownPct: string;
  readonly tradeCount: number;
}

export interface WalkForwardWindowResult {
  readonly index: number;
  readonly train: WalkForwardRunSummary;
  readonly test: WalkForwardRunSummary;
}

export interface WalkForwardReport {
  readonly windows: readonly WalkForwardWindowResult[];
  readonly averageTrainReturnPct: string;
  readonly averageTestReturnPct: string;
  readonly profitableTestWindows: number;
  readonly windowCount: number;
}

export function createWalkForwardWindows(options: WalkForwardOptions): readonly WalkForwardWindow[] {
  validateOptions(options);

  const stepMs = options.stepMs ?? options.testMs;
  const windows: WalkForwardWindow[] = [];
  let trainFromMs = options.request.fromMs;

  while (true) {
    const trainToMs = trainFromMs + options.trainMs;
    const testToMs = trainToMs + options.testMs;
    if (testToMs > options.request.toMs) break;

    windows.push({
      index: windows.length,
      train: {
        ...options.request,
        fromMs: trainFromMs,
        toMs: trainToMs
      },
      test: {
        ...options.request,
        fromMs: trainToMs,
        toMs: testToMs
      }
    });

    trainFromMs += stepMs;
  }

  if (windows.length === 0) {
    throw new Error("Walk-forward range does not contain a complete train/test window");
  }

  return windows;
}

export async function runWalkForwardReport(
  windows: readonly WalkForwardWindow[],
  runWindow: (request: CandleFeedRequest) => Promise<WalkForwardRunSummary>
): Promise<WalkForwardReport> {
  const results: WalkForwardWindowResult[] = [];

  for (const window of windows) {
    results.push({
      index: window.index,
      train: await runWindow(window.train),
      test: await runWindow(window.test)
    });
  }

  return {
    windows: results,
    averageTrainReturnPct: average(results.map((result) => Number(result.train.totalReturnPct))),
    averageTestReturnPct: average(results.map((result) => Number(result.test.totalReturnPct))),
    profitableTestWindows: results.filter((result) => Number(result.test.totalReturnPct) > 0).length,
    windowCount: results.length
  };
}

function validateOptions(options: WalkForwardOptions): void {
  const { request, trainMs, testMs, stepMs } = options;
  if (
    !Number.isSafeInteger(request.fromMs) ||
    !Number.isSafeInteger(request.toMs) ||
    request.fromMs >= request.toMs
  ) {
    throw new Error("Walk-forward request time range must be increasing");
  }
  if (!Number.isSafeInteger(trainMs) || trainMs <= 0) {
    throw new Error("Walk-forward train window must be positive");
  }
  if (!Number.isSafeInteger(testMs) || testMs <= 0) {
    throw new Error("Walk-forward test window must be positive");
  }
  if (stepMs !== undefined && (!Number.isSafeInteger(stepMs) || stepMs <= 0)) {
    throw new Error("Walk-forward step must be positive");
  }
}

function average(values: readonly number[]): string {
  if (values.length === 0) return "0.000000";
  const sum = values.reduce((total, value) => total + value, 0);
  return (sum / values.length).toFixed(6);
}
