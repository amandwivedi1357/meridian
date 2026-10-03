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
      parseIngestorMainMode([
        "backfill-klines",
        "--symbol",
        "BTCUSDT",
        "--interval",
        "1m"
      ])
    ).toEqual({
      kind: "backfill-klines",
      args: ["--symbol", "BTCUSDT", "--interval", "1m"]
    });
  });

  it("rejects unknown modes", () => {
    expect(() => parseIngestorMainMode(["unknown-mode"])).toThrow();
  });
});
