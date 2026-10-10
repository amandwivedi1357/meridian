import { describe, expect, it, vi } from "vitest";

import { createStrategyControlReader } from "./strategy-control-reader.js";

describe("createStrategyControlReader", () => {
  it("reads paused strategy state from Postgres", async () => {
    const query = vi.fn(async () => ({ rows: [{ paused: true }] }));
    const reader = createStrategyControlReader({ query });

    await expect(reader.isPaused("ema-live")).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith({
      text: "SELECT paused FROM strategy_control_state WHERE strategy_id = $1",
      values: ["ema-live"]
    });
  });

  it("treats missing strategy state as unpaused", async () => {
    const reader = createStrategyControlReader({
      query: vi.fn(async () => ({ rows: [] }))
    });

    await expect(reader.isPaused("ema-live")).resolves.toBe(false);
  });

  it("rejects invalid strategy ids and malformed rows", async () => {
    const reader = createStrategyControlReader({
      query: vi.fn(async () => ({ rows: [{ paused: "yes" }] }))
    });

    await expect(reader.isPaused("bad.id")).rejects.toThrow("Invalid strategy id");
    await expect(reader.isPaused("ema-live")).rejects.toThrow("Invalid strategy control state row");
  });
});
