import { describe, expect, it, vi } from "vitest";

import { createEngineMainEntry } from "./main-entry.js";

describe("createEngineMainEntry", () => {
  it("delegates to the configured engine runner", async () => {
    const run = vi.fn(async () => ({
      kind: "engine-stopped" as const,
      pollIterations: 2,
      marketMessagesProcessed: 3
    }));
    const main = createEngineMainEntry({ run });

    await expect(main()).resolves.toEqual({
      kind: "engine-stopped",
      pollIterations: 2,
      marketMessagesProcessed: 3
    });
    expect(run).toHaveBeenCalledOnce();
  });
});
