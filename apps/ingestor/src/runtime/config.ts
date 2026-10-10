import { loadConfig } from "@meridian/config";

export interface IngestorConfig {
  readonly postgresUrl: string;
  readonly redisUrl: string;
  readonly redisStreamMaxLen?: number;
  readonly sessionRecordingPath?: string;
}

export function loadIngestorConfig(env: NodeJS.ProcessEnv = process.env): IngestorConfig {
  const config = loadConfig(env);

  const redisStreamMaxLen = parseOptionalPositiveInteger(
    env.INGESTOR_REDIS_STREAM_MAXLEN,
    "INGESTOR_REDIS_STREAM_MAXLEN"
  );

  return {
    postgresUrl: config.DATABASE_URL,
    redisUrl: config.REDIS_URL,
    ...(redisStreamMaxLen === undefined ? {} : { redisStreamMaxLen }),
    ...(config.INGESTOR_SESSION_RECORDING_PATH
      ? { sessionRecordingPath: config.INGESTOR_SESSION_RECORDING_PATH }
      : {})
  };
}

function parseOptionalPositiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;

  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}
