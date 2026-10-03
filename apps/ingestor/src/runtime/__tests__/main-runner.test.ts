import { describe, expect, it, vi } from "vitest";
import { runIngestorMain } from "../main-runner.js";

describe("runIngestorMain", () => {
  it("runs live mode by default", async () => {
    const runLive = vi.fn(async () => ({ kind: "live-started" as const }));
    const runBackfillKlines = vi.fn(async () => ({
      requestsPlanned: 0,
      requestsCompleted: 0,
      candlesWritten: 0
    }));

    const result = await runIngestorMain([], {
      runLive,
      runBackfillKlines
    });

    expect(runLive).toHaveBeenCalledOnce();
    expect(runBackfillKlines).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "live-started" });
  });

  it("runs kline backfill mode with remaining args", async () => {
    const runLive = vi.fn(async () => ({ kind: "live-started" as const }));
    const runBackfillKlines = vi.fn(async () => ({
      requestsPlanned: 1,
      requestsCompleted: 1,
      candlesWritten: 10
    }));

    const result = await runIngestorMain(
      ["backfill-klines", "--symbol", "BTCUSDT"],
      {
        runLive,
        runBackfillKlines
      }
    );

    expect(runLive).not.toHaveBeenCalled();
    expect(runBackfillKlines).toHaveBeenCalledWith(["--symbol", "BTCUSDT"]);
    expect(result).toEqual({
      requestsPlanned: 1,
      requestsCompleted: 1,
      candlesWritten: 10
    });
  });
});
