import { loadConfig } from "@meridian/config";

export interface IngestorConfig {
  readonly postgresUrl: string;
  readonly redisUrl: string;
}

export function loadIngestorConfig(
  env: NodeJS.ProcessEnv = process.env
): IngestorConfig {
  const config = loadConfig(env);

  return {
    postgresUrl: config.DATABASE_URL,
    redisUrl: config.REDIS_URL
  };
}