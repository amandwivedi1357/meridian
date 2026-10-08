export interface EngineServiceRuntime {
  readonly pollMarketOnce: () => Promise<number>;
}

export interface EngineServiceLoopLogger {
  readonly info: (data: Record<string, unknown>, message: string) => void;
  readonly warn: (data: Record<string, unknown>, message: string) => void;
  readonly error: (data: Record<string, unknown>, message: string) => void;
}

export interface EngineServiceLoopOptions {
  readonly runtime: EngineServiceRuntime;
  readonly logger: EngineServiceLoopLogger;
  readonly shouldContinue: () => boolean;
  readonly sleepMs: (durationMs: number) => Promise<void>;
  readonly idleDelayMs: number;
  readonly errorDelayMs: number;
}

export interface EngineServiceLoopResult {
  readonly pollIterations: number;
  readonly marketMessagesProcessed: number;
}

export async function runEngineServiceLoop(
  options: EngineServiceLoopOptions
): Promise<EngineServiceLoopResult> {
  let pollIterations = 0;
  let marketMessagesProcessed = 0;

  options.logger.info({}, "engine service loop started");

  while (options.shouldContinue()) {
    try {
      const processed = await options.runtime.pollMarketOnce();
      pollIterations += 1;
      marketMessagesProcessed += processed;

      if (processed === 0) {
        await options.sleepMs(options.idleDelayMs);
      }
    } catch (error) {
      options.logger.error({ error }, "engine service loop iteration failed");
      await options.sleepMs(options.errorDelayMs);
    }
  }

  options.logger.info(
    {
      pollIterations,
      marketMessagesProcessed
    },
    "engine service loop stopped"
  );

  return {
    pollIterations,
    marketMessagesProcessed
  };
}
