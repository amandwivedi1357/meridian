import { describe, expect, it } from "vitest";
import { loadIngestorConfig } from "../config.js";

describe("loadIngestorConfig", () => {
  it("loads Redis and Postgres URLs from Meridian config", () => {
    const config = loadIngestorConfig({
      DATABASE_URL: "postgres://meridian:meridian@localhost:5432/meridian",
      JWT_SECRET: "super-secret-value",
      REDIS_URL: "redis://localhost:6379"
    });

    expect(config).toEqual({
      postgresUrl: "postgres://meridian:meridian@localhost:5432/meridian",
      redisUrl: "redis://localhost:6379"
    });
  });

  it("loads optional session recording path", () => {
    const config = loadIngestorConfig({
      DATABASE_URL: "postgres://meridian:meridian@localhost:5432/meridian",
      INGESTOR_SESSION_RECORDING_PATH: "sessions/local/events.ndjson",
      JWT_SECRET: "super-secret-value",
      REDIS_URL: "redis://localhost:6379"
    });

    expect(config).toEqual({
      postgresUrl: "postgres://meridian:meridian@localhost:5432/meridian",
      redisUrl: "redis://localhost:6379",
      sessionRecordingPath: "sessions/local/events.ndjson"
    });
  });

  it("loads optional Redis stream retention max length", () => {
    const config = loadIngestorConfig({
      DATABASE_URL: "postgres://meridian:meridian@localhost:5432/meridian",
      INGESTOR_REDIS_STREAM_MAXLEN: "100000",
      JWT_SECRET: "super-secret-value",
      REDIS_URL: "redis://localhost:6379"
    });

    expect(config).toEqual({
      postgresUrl: "postgres://meridian:meridian@localhost:5432/meridian",
      redisUrl: "redis://localhost:6379",
      redisStreamMaxLen: 100000
    });
  });

  it("rejects invalid Redis stream retention values", () => {
    expect(() =>
      loadIngestorConfig({
        DATABASE_URL: "postgres://meridian:meridian@localhost:5432/meridian",
        INGESTOR_REDIS_STREAM_MAXLEN: "0",
        JWT_SECRET: "super-secret-value",
        REDIS_URL: "redis://localhost:6379"
      })
    ).toThrow("INGESTOR_REDIS_STREAM_MAXLEN");
  });

  it("rejects invalid URLs before startup", () => {
    expect(() =>
      loadIngestorConfig({
        DATABASE_URL: "not-a-url",
        JWT_SECRET: "super-secret-value",
        REDIS_URL: "redis://localhost:6379"
      })
    ).toThrow();
  });
});
