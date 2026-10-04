export type IngestorMainMode =
  | {
      readonly kind: "live";
    }
  | {
      readonly kind: "backfill-klines";
      readonly args: readonly string[];
    }
  | {
      readonly kind: "smoke-redis-publish";
    }
  | {
      readonly kind: "smoke-live-ingest";
      readonly args: readonly string[];
    };

export function parseIngestorMainMode(args: readonly string[]): IngestorMainMode {
  const [mode, ...rest] = args;

  if (mode === undefined) {
    return { kind: "live" };
  }

  if (mode === "backfill-klines") {
    return {
      kind: "backfill-klines",
      args: rest
    };
  }

  if (mode === "smoke-redis-publish") {
    return { kind: "smoke-redis-publish" };
  }

  if (mode === "smoke-live-ingest") {
    return {
      kind: "smoke-live-ingest",
      args: rest
    };
  }

  throw new Error(`Unknown ingestor mode: ${mode}`);
}
