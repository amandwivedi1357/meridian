import { describe, expect, it } from "vitest";
import { parseBacktestArgs } from "./arguments.js";

const dates = ["--from", "2024-01-01", "--to", "2024-02-01"];

describe("parseBacktestArgs", () => {
  it("defaults to EMA, BTCUSDT and 15-minute candles with UTC boundaries", () => {
    expect(parseBacktestArgs(dates)).toEqual({
      strategy: "ema",
      request: {
        symbol: "BTCUSDT",
        interval: "15m",
        fromMs: Date.UTC(2024, 0, 1),
        toMs: Date.UTC(2024, 1, 1)
      },
      saveRun: false
    });
  });

  it("accepts explicit options in any order including hourly candles", () => {
    expect(
      parseBacktestArgs([
        "--interval",
        "1h",
        "--to",
        "2024-02-01",
        "--symbol",
        "BTCUSDT",
        "--from",
        "2024-01-01",
        "--strategy",
        "ema"
      ]).request.interval
    ).toBe("1h");
  });

  it("accepts leap day in a leap year", () => {
    expect(parseBacktestArgs(["--from", "2024-02-29", "--to", "2024-03-01"]).request.fromMs).toBe(
      Date.UTC(2024, 1, 29)
    );
  });

  it.each(["2023-02-29", "2024-02-30", "2024-04-31", "2024-13-01", "2024-00-01", "2024-01-00"])(
    "rejects invalid calendar date %s instead of normalizing it",
    (value) => {
      expect(() => parseBacktestArgs(["--from", value, "--to", "2025-01-01"])).toThrow(
        "Invalid calendar date"
      );
    }
  );

  it.each(["2024-1-01", "01/01/2024", "2024-01-01T00:00:00Z", "yesterday"])(
    "rejects unsupported date format %s",
    (value) => {
      expect(() => parseBacktestArgs(["--from", value, "--to", "2025-01-01"])).toThrow(
        "Dates must use YYYY-MM-DD in UTC"
      );
    }
  );

  it.each([[], ["--from", "2024-01-01"], ["--to", "2024-02-01"]].map((args) => ({ args })))(
    "requires both date boundaries %j",
    ({ args }) => {
      expect(() => parseBacktestArgs(args)).toThrow("Dates must use YYYY-MM-DD in UTC");
    }
  );

  it.each(["2024-01-01", "2023-12-31"])(
    "rejects an end date that does not follow the start (%s)",
    (to) => {
      expect(() => parseBacktestArgs(["--from", "2024-01-01", "--to", to])).toThrow(
        "From must precede to"
      );
    }
  );

  it.each(
    [
      ["--strategy", "sma"],
      ["--symbol", "ETHUSDT"]
    ].map((flags) => ({ flags }))
  )("rejects unsupported slice settings %j", ({ flags }) => {
    expect(() => parseBacktestArgs([...dates, ...flags])).toThrow(
      "This slice supports EMA on BTCUSDT only"
    );
  });

  it.each(["1m", "5m", "1d"])("rejects unsupported interval %s", (interval) => {
    expect(() => parseBacktestArgs([...dates, "--interval", interval])).toThrow(
      "Interval must be 15m or 1h"
    );
  });

  it("accepts saving a run with an optional explicit run id", () => {
    expect(parseBacktestArgs([...dates, "--save-run"])).toMatchObject({
      saveRun: true
    });
    expect(parseBacktestArgs([...dates, "--save-run", "--run-id", "ema:BTCUSDT:jan-2024"])).toMatchObject({
      saveRun: true,
      runId: "ema:BTCUSDT:jan-2024"
    });
  });

  it("requires save-run before accepting an explicit run id", () => {
    expect(() => parseBacktestArgs([...dates, "--run-id", "manual-id"])).toThrow(
      "--run-id requires --save-run"
    );
  });

  it.each(["", "bad id", "bad/id", "bad$id"])("rejects unsafe run ids %s", (runId) => {
    expect(() => parseBacktestArgs([...dates, "--save-run", "--run-id", runId])).toThrow();
  });

  it.each(
    [
      ["--unknown", "value"],
      ["--interval"],
      ["--interval", "--symbol"],
      ["--from", "2024-01-01"],
      ["--symbol", "BTCUSDT", "--symbol", "BTCUSDT"],
      ["--save-run", "--save-run"],
      ["ema"],
      ["--interval", ""]
    ].map((flags) => ({ flags }))
  )("rejects unknown, duplicated, or incomplete flags %j", ({ flags }) => {
    expect(() => parseBacktestArgs([...dates, ...flags])).toThrow(
      "Unknown, duplicate, or incomplete CLI flag"
    );
  });
});
