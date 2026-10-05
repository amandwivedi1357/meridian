import { Worker } from "node:worker_threads";

export interface ParallelBacktestJob {
  readonly id: string;
  readonly args: readonly string[];
}

export interface ParallelBacktestResult {
  readonly id: string;
  readonly ok: boolean;
  readonly output?: unknown;
  readonly error?: string;
}

export interface WorkerThreadRunnerDeps {
  readonly workerScript: URL | string;
  readonly createWorker?: (script: URL | string, options: { readonly workerData: ParallelBacktestJob }) => WorkerLike;
}

export interface WorkerLike {
  readonly once: (event: "message" | "error" | "exit", listener: (...args: unknown[]) => void) => void;
}

export async function runBacktestJobInWorker(
  job: ParallelBacktestJob,
  deps: WorkerThreadRunnerDeps
): Promise<ParallelBacktestResult> {
  const createWorker =
    deps.createWorker ??
    ((script, options) => new Worker(script, { workerData: options.workerData }));
  const worker = createWorker(deps.workerScript, { workerData: job });

  return await new Promise((resolve) => {
    let settled = false;
    const settle = (result: ParallelBacktestResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    worker.once("message", (message) => {
      settle({ id: job.id, ok: true, output: message });
    });
    worker.once("error", (error) => {
      settle({
        id: job.id,
        ok: false,
        error: error instanceof Error ? error.message : "Worker failed"
      });
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        settle({ id: job.id, ok: false, error: `Worker exited with code ${String(code)}` });
      }
    });
  });
}

export interface BacktestQueue {
  readonly add: (name: string, data: ParallelBacktestJob) => Promise<{ readonly id?: string }>;
}

export async function enqueueBacktestSweep(
  queue: BacktestQueue,
  jobs: readonly ParallelBacktestJob[]
): Promise<readonly string[]> {
  const ids: string[] = [];

  for (const job of jobs) {
    const queued = await queue.add("backtest", job);
    ids.push(queued.id ?? job.id);
  }

  return ids;
}
