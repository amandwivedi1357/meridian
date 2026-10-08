import type { ExecutorRuntime } from "./executor-runtime.js";
import {
  runExecutorServiceLoop,
  type ExecutorServiceLoopLogger,
  type ExecutorServiceLoopResult
} from "./executor-service-loop.js";

export interface ExecutorMainRunnerDeps {
  readonly runtime: ExecutorRuntime;
  readonly logger: ExecutorServiceLoopLogger;
  readonly shouldContinue: () => boolean;
  readonly sleepMs: (durationMs: number) => Promise<void>;
  readonly idleDelayMs: number;
  readonly errorDelayMs: number;
  readonly staleClaimIntervalMs: number;
  readonly nowMs: () => number;
  readonly safetyTick?: () => Promise<void>;
  readonly onStartupFailure?: (error: unknown) => Promise<void>;
}

export interface ExecutorMainResult extends ExecutorServiceLoopResult {
  readonly kind: "executor-stopped";
}

export async function runExecutorMain(deps: ExecutorMainRunnerDeps): Promise<ExecutorMainResult> {
  try {
    await deps.runtime.start();
  } catch (error) {
    if (deps.onStartupFailure === undefined) throw error;
    await deps.onStartupFailure(error);
  }

  const result = await runExecutorServiceLoop({
    runtime: deps.runtime,
    logger: deps.logger,
    shouldContinue: deps.shouldContinue,
    sleepMs: deps.sleepMs,
    idleDelayMs: deps.idleDelayMs,
    errorDelayMs: deps.errorDelayMs,
    staleClaimIntervalMs: deps.staleClaimIntervalMs,
    nowMs: deps.nowMs,
    ...(deps.safetyTick === undefined ? {} : { safetyTick: deps.safetyTick })
  });

  return {
    kind: "executor-stopped",
    ...result
  };
}
