import { describe, expect, it } from "vitest";
import { curves, rangeError, requestFor, shouldPoll } from "./backtest-model.js";
import type { Job } from "./backtest-api.js";

describe("backtest launcher and results", () => {
  const now = Date.parse("2026-10-11T12:00:00Z");
  it("validates real past UTC dates and at most 30 days", () => {
    expect(rangeError("2026-10-01", "2026-10-11", now)).toBeNull();
    expect(rangeError("2026-02-30", "2026-03-01", now)).toBe("Select valid UTC dates");
    expect(rangeError("2026-10-11", "2026-10-10", now)).toBe("End date must follow start date");
    expect(rangeError("2026-10-10", "2026-10-12", now)).toBe("End date must be in the past");
    expect(rangeError("2026-09-01", "2026-10-11", now)).toBe("Maximum range is 30 days");
  });
  it("reuses the submission identity after uncertain outcomes but not edited requests", () => {
    const form = {
      strategy: "ema" as const,
      symbol: "BTCUSDT" as const,
      interval: "15m" as const,
      from: "2026-10-01",
      to: "2026-10-02"
    };
    const first = requestFor(form, null, () => "first");
    expect(requestFor(form, first, () => "second")).toBe(first);
    expect(requestFor({ ...form, interval: "1h" }, first, () => "second").requestId).toBe("second");
  });
  it.each(["queued", "running", "succeeded", "failed"] as const)(
    "only watches active job state: %s",
    (state) => {
      expect(shouldPoll({ state } as Job, null)).toBe(
        state === "queued" || state === "running" ? 2000 : false
      );
      expect(shouldPoll({ state } as Job, new Error())).toBe(false);
    }
  );
  it("calculates drawdown from the saved initial balance, including an immediate loss", () => {
    const result = curves(
      [
        { index: 0, tsMs: "1000", equity: "9000" },
        { index: 1, tsMs: "2000", equity: "11000" },
        { index: 2, tsMs: "3000", equity: "9900" }
      ],
      "10000"
    );
    expect(result.drawdown.map((p) => p.value)).toEqual([-10, 0, -10]);
  });
  it("handles absent baseline and zero equity without nonfinite values", () => {
    expect(
      curves(
        [
          { index: 0, tsMs: "1000", equity: "0" },
          { index: 1, tsMs: "2000", equity: "0" }
        ],
        undefined
      ).drawdown.map((p) => p.value)
    ).toEqual([0, 0]);
  });
  it("rejects malformed or out-of-order data rather than drawing an invented curve", () => {
    for (const equity of ["NaN", "-1", "1e1000000"])
      expect(() => curves([{ index: 0, tsMs: "1000", equity }], "10000")).toThrow();
    expect(() =>
      curves(
        [
          { index: 0, tsMs: "1000", equity: "10000" },
          { index: 1, tsMs: "1000", equity: "10001" }
        ],
        "10000"
      )
    ).toThrow();
    expect(() => curves([{ index: 0, tsMs: "1.5", equity: "10000" }], "10000")).toThrow();
  });
});
