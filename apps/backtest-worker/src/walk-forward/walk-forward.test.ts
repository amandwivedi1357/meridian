import { describe, expect, it, vi } from "vitest";
import { createWalkForwardWindows, runWalkForwardReport } from "./walk-forward.js";

const request = {
  symbol: "BTCUSDT",
  interval: "15m" as const,
  fromMs: 0,
  toMs: 10
};

describe("walk-forward reporting", () => {
  it("creates rolling train/test windows", () => {
    expect(createWalkForwardWindows({ request, trainMs: 4, testMs: 2 })).toEqual([
      {
        index: 0,
        train: { ...request, fromMs: 0, toMs: 4 },
        test: { ...request, fromMs: 4, toMs: 6 }
      },
      {
        index: 1,
        train: { ...request, fromMs: 2, toMs: 6 },
        test: { ...request, fromMs: 6, toMs: 8 }
      },
      {
        index: 2,
        train: { ...request, fromMs: 4, toMs: 8 },
        test: { ...request, fromMs: 8, toMs: 10 }
      }
    ]);
  });

  it("supports custom walk step size", () => {
    expect(createWalkForwardWindows({ request, trainMs: 4, testMs: 2, stepMs: 4 })).toHaveLength(2);
  });

  it("builds an out-of-sample summary report", async () => {
    const windows = createWalkForwardWindows({ request, trainMs: 4, testMs: 2, stepMs: 4 });
    const runWindow = vi
      .fn()
      .mockResolvedValueOnce({ totalReturnPct: "2.0", maxDrawdownPct: "1", tradeCount: 3 })
      .mockResolvedValueOnce({ totalReturnPct: "-1.0", maxDrawdownPct: "2", tradeCount: 1 })
      .mockResolvedValueOnce({ totalReturnPct: "4.0", maxDrawdownPct: "1", tradeCount: 3 })
      .mockResolvedValueOnce({ totalReturnPct: "3.0", maxDrawdownPct: "2", tradeCount: 1 });

    await expect(runWalkForwardReport(windows, runWindow)).resolves.toMatchObject({
      averageTrainReturnPct: "3.000000",
      averageTestReturnPct: "1.000000",
      profitableTestWindows: 1,
      windowCount: 2
    });
    expect(runWindow).toHaveBeenCalledTimes(4);
  });

  it.each([
    { trainMs: 0, testMs: 1 },
    { trainMs: 1, testMs: 0 },
    { trainMs: 8, testMs: 4 }
  ])("rejects invalid windows %j", (override) => {
    expect(() => createWalkForwardWindows({ request, ...override })).toThrow();
  });
});
