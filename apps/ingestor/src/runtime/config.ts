import { loadConfig } from "@meridian/config";

export interface IngestorConfig {
  readonly postgresUrl: string;
  readonly redisUrl: string;
  readonly sessionRecordingPath?: string;
}

export function loadIngestorConfig(env: NodeJS.ProcessEnv = process.env): IngestorConfig {
  const config = loadConfig(env);

  return {
    postgresUrl: config.DATABASE_URL,
    redisUrl: config.REDIS_URL,
    ...(config.INGESTOR_SESSION_RECORDING_PATH
      ? { sessionRecordingPath: config.INGESTOR_SESSION_RECORDING_PATH }
      : {})
  };
}
