import { describe, expect, it, vi } from "vitest";

import { createExecutorMainEntry } from "./main-entry.js";

describe("createExecutorMainEntry", () => {
  it("delegates to the configured executor runner", async () => {
    const run = vi.fn(async () => ({
      kind: "executor-stopped" as const,
      pollIterations: 1,
      staleClaimIterations: 1
    }));
    const main = createExecutorMainEntry({ run });

    await expect(main()).resolves.toEqual({
      kind: "executor-stopped",
      pollIterations: 1,
      staleClaimIterations: 1
    });
    expect(run).toHaveBeenCalledOnce();
  });
});
