import type { ExecutorMainResult } from "./main-runner.js";

export interface ExecutorMainEntryDeps {
  readonly run: () => Promise<ExecutorMainResult>;
}

export function createExecutorMainEntry(deps: ExecutorMainEntryDeps) {
  return (): Promise<ExecutorMainResult> => deps.run();
}
