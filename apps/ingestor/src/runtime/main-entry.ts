import type { IngestorMainResult } from "./main-runner.js";

export interface MainEntryDeps {
  readonly run: (args: readonly string[]) => Promise<IngestorMainResult>;
}

export function createMain(deps: MainEntryDeps) {
  return (argv: readonly string[] = process.argv): Promise<IngestorMainResult> => {
    return deps.run(argv.slice(2));
  };
}