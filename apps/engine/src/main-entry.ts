import type { EngineMainResult } from "./main-runner.js";

export interface EngineMainEntryDeps {
  readonly run: () => Promise<EngineMainResult>;
}

export function createEngineMainEntry(deps: EngineMainEntryDeps) {
  return (): Promise<EngineMainResult> => deps.run();
}
