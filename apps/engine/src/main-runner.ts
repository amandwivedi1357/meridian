import type { EngineRuntime } from "./engine-runtime.js";
import {
  runEngineServiceLoop,
  type EngineServiceLoopLogger,
  type EngineServiceLoopResult
} from "./engine-service-loop.js";

export interface EngineMainRunnerDeps {
  readonly runtime: EngineRuntime;
  readonly logger: EngineServiceLoopLogger;
  readonly shouldContinue: () => boolean;
  readonly sleepMs: (durationMs: number) => Promise<void>;
  readonly idleDelayMs: number;
  readonly errorDelayMs: number;
}

export interface EngineMainResult extends EngineServiceLoopResult {
  readonly kind: "engine-stopped";
}

export async function runEngineMain(deps: EngineMainRunnerDeps): Promise<EngineMainResult> {
  await deps.runtime.start();

  const result = await runEngineServiceLoop({
    runtime: deps.runtime,
    logger: deps.logger,
    shouldContinue: deps.shouldContinue,
    sleepMs: deps.sleepMs,
    idleDelayMs: deps.idleDelayMs,
    errorDelayMs: deps.errorDelayMs
  });

  return {
    kind: "engine-stopped",
    ...result
  };
}
