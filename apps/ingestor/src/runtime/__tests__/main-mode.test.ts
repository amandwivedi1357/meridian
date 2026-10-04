import { describe, expect, it } from "vitest";
import { parseIngestorMainMode } from "../main-mode.js";

describe("parseIngestorMainMode", () => {
  it("defaults to live ingest mode", () => {
    expect(parseIngestorMainMode([])).toEqual({
      kind: "live"
    });
  });

  it("parses backfill mode and keeps remaining args for the backfill command", () => {
    expect(
      parseIngestorMainMode(["backfill-klines", "--symbol", "BTCUSDT", "--interval", "1m"])
    ).toEqual({
      kind: "backfill-klines",
      args: ["--symbol", "BTCUSDT", "--interval", "1m"]
    });
  });

  it("parses Redis publish smoke mode", () => {
    expect(parseIngestorMainMode(["smoke-redis-publish"])).toEqual({
      kind: "smoke-redis-publish"
    });
  });

  it("parses live ingest smoke mode and keeps remaining args", () => {
    expect(
      parseIngestorMainMode(["smoke-live-ingest", "--symbol", "ETHUSDT", "--events", "2"])
    ).toEqual({
      kind: "smoke-live-ingest",
      args: ["--symbol", "ETHUSDT", "--events", "2"]
    });
  });

  it("rejects unknown modes", () => {
    expect(() => parseIngestorMainMode(["unknown-mode"])).toThrow();
  });
});
