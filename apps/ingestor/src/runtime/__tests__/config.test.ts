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
