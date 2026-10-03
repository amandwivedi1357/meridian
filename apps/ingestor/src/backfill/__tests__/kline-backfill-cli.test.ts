import { describe, expect, it } from "vitest";
import { parseKlineBackfillArgs } from "../kline-backfill-cli.js";

describe("parseKlineBackfillArgs", () => {
  it("parses CLI flags into a backfill plan input", () => {
    const parsed = parseKlineBackfillArgs([
      "--symbol",
      "BTCUSDT",
      "--interval",
      "1m",
      "--start",
      "2026-01-01T00:00:00.000Z",
      "--end",
      "2026-01-01T00:10:00.000Z",
      "--limit",
      "500"
    ]);

    expect(parsed).toEqual({
      symbol: "BTCUSDT",
      interval: "1m",
      startTimeMs: Date.parse("2026-01-01T00:00:00.000Z"),
      endTimeMs: Date.parse("2026-01-01T00:10:00.000Z"),
      limit: 500
    });
  });

  it("defaults limit to Binance's max kline page size", () => {
    const parsed = parseKlineBackfillArgs([
      "--symbol",
      "ETHUSDT",
      "--interval",
      "5m",
      "--start",
      "2026-01-01T00:00:00.000Z",
      "--end",
      "2026-01-01T01:00:00.000Z"
    ]);

    expect(parsed.limit).toBe(1000);
  });

  it("rejects missing required flags and invalid dates", () => {
    expect(() => parseKlineBackfillArgs(["--symbol", "BTCUSDT"])).toThrow();
    expect(() =>
      parseKlineBackfillArgs([
        "--symbol",
        "BTCUSDT",
        "--interval",
        "1m",
        "--start",
        "not-a-date",
        "--end",
        "2026-01-01T00:10:00.000Z"
      ])
    ).toThrow();
  });
});
