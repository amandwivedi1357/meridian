import { describe, expect, it } from "vitest";
import { loadConfig } from "./index.js";

describe("loadConfig", () => {
  it("loads optional ingestor session recording path", () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://meridian:meridian@localhost:5432/meridian",
      INGESTOR_SESSION_RECORDING_PATH: "sessions/local/events.ndjson",
      JWT_SECRET: "super-secret-value",
      REDIS_URL: "redis://localhost:6379"
    });

    expect(config.INGESTOR_SESSION_RECORDING_PATH).toBe("sessions/local/events.ndjson");
  });
});
