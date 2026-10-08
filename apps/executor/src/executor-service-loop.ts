import type { SignalProcessingResult } from "./signal-execution.js";

export interface ExecutorServiceRuntime {
  readonly pollSignalsOnce: () => Promise<readonly SignalProcessingResult[]>;
  readonly claimStaleSignalsOnce: () => Promise<readonly SignalProcessingResult[]>;
}

export interface ExecutorServiceLoopLogger {
  readonly info: (data: Record<string, unknown>, message: string) => void;
  readonly warn: (data: Record<string, unknown>, message: string) => void;
  readonly error: (data: Record<string, unknown>, message: string) => void;
}

export interface ExecutorServiceLoopOptions {
  readonly runtime: ExecutorServiceRuntime;
  readonly logger: ExecutorServiceLoopLogger;
  readonly shouldContinue: () => boolean;
  readonly sleepMs: (durationMs: number) => Promise<void>;
  readonly idleDelayMs: number;
  readonly errorDelayMs: number;
  readonly staleClaimIntervalMs: number;
  readonly nowMs: () => number;
  readonly safetyTick?: () => Promise<void>;
}

export interface ExecutorServiceLoopResult {
  readonly pollIterations: number;
  readonly staleClaimIterations: number;
}

export async function runExecutorServiceLoop(
  options: ExecutorServiceLoopOptions
): Promise<ExecutorServiceLoopResult> {
  let pollIterations = 0;
  let staleClaimIterations = 0;
  let nextStaleClaimAtMs = options.nowMs();

  options.logger.info({}, "executor service loop started");

  while (options.shouldContinue()) {
    const nowMs = options.nowMs();

    try {
      await options.safetyTick?.();
      if (nowMs >= nextStaleClaimAtMs) {
        const staleResults = await options.runtime.claimStaleSignalsOnce();
        staleClaimIterations += 1;
        nextStaleClaimAtMs = nowMs + options.staleClaimIntervalMs;

        if (staleResults.length > 0) {
          options.logger.info(
            { processed: staleResults.length },
            "stale signal messages processed"
          );
        }
      }

      const results = await options.runtime.pollSignalsOnce();
      pollIterations += 1;

      if (results.length === 0) {
        await options.sleepMs(options.idleDelayMs);
      }
    } catch (error) {
      options.logger.error({ error }, "executor service loop iteration failed");
      await options.sleepMs(options.errorDelayMs);
    }
  }

  options.logger.info(
    {
      pollIterations,
      staleClaimIterations
    },
    "executor service loop stopped"
  );

  return {
    pollIterations,
    staleClaimIterations
  };
}
