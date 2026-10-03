import { describe, expect, it, vi } from "vitest";
import { runKlineBackfillCommand } from "../kline-backfill-command.js";

describe("runKlineBackfillCommand", () => {
  it("parses argv and runs the backfill service", async () => {
    const service = {
      run: vi.fn(async () => ({
        requestsPlanned: 1,
        requestsCompleted: 1,
        candlesWritten: 10
      }))
    };

    const result = await runKlineBackfillCommand(
      [
        "--symbol",
        "BTCUSDT",
        "--interval",
        "1m",
        "--start",
        "2026-01-01T00:00:00.000Z",
        "--end",
        "2026-01-01T00:10:00.000Z"
      ],
      { service }
    );

    expect(service.run).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      interval: "1m",
      startTimeMs: Date.parse("2026-01-01T00:00:00.000Z"),
      endTimeMs: Date.parse("2026-01-01T00:10:00.000Z"),
      limit: 1000
    });
    expect(result).toEqual({
      requestsPlanned: 1,
      requestsCompleted: 1,
      candlesWritten: 10
    });
  });
});
