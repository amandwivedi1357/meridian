import type { IngestorApp } from "./app-bootstrap.js";

export interface ManagedIngestorApp extends IngestorApp {
  readonly stop: () => Promise<void>;
}

export function createManagedIngestorApp(app: IngestorApp): ManagedIngestorApp {
  let startPromise: ReturnType<IngestorApp["start"]> | undefined;
  let started = false;
  let stopped = false;

  return {
    async start() {
      if (stopped) {
        throw new Error("Ingestor app is stopped");
      }

      startPromise ??= app.start();
      const result = await startPromise;
      started = true;
      return result;
    },

    async ingest(input) {
      if (stopped) {
        throw new Error("Ingestor app is stopped");
      }

      if (!started) {
        throw new Error("Ingestor app is not started");
      }

      return app.ingest(input);
    },

    async stop() {
      stopped = true;
    }
  };
}