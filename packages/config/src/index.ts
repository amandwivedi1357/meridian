import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3000),
  BINANCE_API_KEY: z.string().optional(),
  BINANCE_API_SECRET: z.string().optional(),
  BINANCE_ENV: z.enum(["testnet", "production"]).default("testnet"),
  BINANCE_PRIVATE_KEY_PATH: z.string().optional(),
  DATABASE_URL: z.string().url(),
  GRAFANA_PORT: z.coerce.number().int().positive().default(3001),
  JWT_SECRET: z.string().min(12),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PROMETHEUS_PORT: z.coerce.number().int().positive().default(9090),
  REDIS_URL: z.string().url(),
  WEB_PORT: z.coerce.number().int().positive().default(5173)
});

export type MeridianConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MeridianConfig {
  return envSchema.parse(env);
}
