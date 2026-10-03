import { describe, expect, it, vi } from "vitest";
import { createMain } from "../main-entry.js";

describe("createMain", () => {
  it("passes process args to the main runner", async () => {
    const run = vi.fn(async () => ({ kind: "live-started" as const }));
    const main = createMain({ run });

    const result = await main(["node", "main.js", "backfill-klines", "--symbol", "BTCUSDT"]);

    expect(run).toHaveBeenCalledWith(["backfill-klines", "--symbol", "BTCUSDT"]);
    expect(result).toEqual({ kind: "live-started" });
  });
});
