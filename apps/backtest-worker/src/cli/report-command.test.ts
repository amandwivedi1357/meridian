import { describe, expect, it, vi } from "vitest";
import { parseBacktestReportArgs, runBacktestReportCommand } from "./report-command.js";
import type { SqlQuery } from "../results/backtest-result-reader.js";

describe("parseBacktestReportArgs", () => {
  it("parses required run id and default output path", () => {
    expect(parseBacktestReportArgs(["--run-id", "ema:BTCUSDT:jan-2024"])).toEqual({
      runId: "ema:BTCUSDT:jan-2024",
      outputPath: "reports\\backtests\\ema-BTCUSDT-jan-2024.html"
    });
  });

  it("accepts an explicit output path", () => {
    expect(
      parseBacktestReportArgs(["--run-id", "run-1", "--output", "tmp/report.html"])
    ).toEqual({
      runId: "run-1",
      outputPath: "tmp/report.html"
    });
  });

  it.each([
    { args: [] },
    { args: ["--run-id"] },
    { args: ["--output", "x.html"] },
    { args: ["--run-id", "a", "--run-id", "b"] }
  ])(
    "rejects invalid report args %j",
    ({ args }) => {
      expect(() => parseBacktestReportArgs(args)).toThrow("Usage: backtest report");
    }
  );
});

describe("runBacktestReportCommand", () => {
  it("loads a saved run and writes an HTML report", async () => {
    const query = vi.fn<(query: SqlQuery) => Promise<{ rows: readonly Record<string, unknown>[] }>>();
    query
      .mockResolvedValueOnce({
        rows: [
          {
            run_id: "run-1",
            strategy: "ema",
            symbol: "BTCUSDT",
            interval: "15m",
            from_ms: 1704067200000,
            to_ms: 1704153600000,
            params: { fastPeriod: 12 },
            metrics: { totalReturnPct: "1.23", tradeCount: 1 },
            created_at: new Date("2024-01-02T00:00:00Z")
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            fill_index: 0,
            symbol: "BTCUSDT",
            side: "BUY",
            quantity: "0.001",
            price: "50000",
            fee: "0.05",
            fee_asset: "USDT",
            ts_ms: 1704070800000
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [{ point_index: 0, ts_ms: 1704070800000, equity: "10000" }]
      });
    const mkdir = vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined);
    const writeFile = vi.fn<(path: string, contents: string) => Promise<void>>().mockResolvedValue(
      undefined
    );

    await expect(
      runBacktestReportCommand(["--run-id", "run-1", "--output", "reports/run-1.html"], {
        query,
        mkdir,
        writeFile
      })
    ).resolves.toEqual({
      runId: "run-1",
      outputPath: "reports/run-1.html"
    });

    expect(mkdir).toHaveBeenCalledWith("reports");
    expect(writeFile.mock.calls[0]?.[0]).toBe("reports/run-1.html");
    expect(writeFile.mock.calls[0]?.[1]).toContain("Backtest report");
    expect(writeFile.mock.calls[0]?.[1]).toContain("run-1");
  });
});
