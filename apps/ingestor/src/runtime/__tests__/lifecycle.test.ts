import { describe, expect, it, vi } from "vitest";
import { createManagedIngestorApp } from "../lifecycle.js";

describe("createManagedIngestorApp", () => {
  it("runs start once before allowing ingest", async () => {
    const start = vi.fn(async () => ({ applied: [], skipped: [] }));
    const ingest = vi.fn(async () => ({
      event: {} as never,
      publishResult: { stream: "market.trade.BTCUSDT", id: "1-0" },
      batchWriteResult: { tradesWritten: 1, klinesWritten: 0, duplicatesSkipped: 0 }
    }));
    const app = createManagedIngestorApp({ start, ingest });

    await expect(app.ingest({ raw: true })).rejects.toThrow("not started");

    await app.start();
    await app.start();
    await app.ingest({ raw: true });

    expect(start).toHaveBeenCalledOnce();
    expect(ingest).toHaveBeenCalledOnce();
  });

  it("prevents ingest after stop", async () => {
    const app = createManagedIngestorApp({
      start: vi.fn(async () => ({ applied: [], skipped: [] })),
      ingest: vi.fn(async () => ({
        event: {} as never,
        publishResult: { stream: "market.trade.BTCUSDT", id: "1-0" },
        batchWriteResult: { tradesWritten: 1, klinesWritten: 0, duplicatesSkipped: 0 }
      }))
    });

    await app.start();
    await app.stop();

    await expect(app.ingest({ raw: true })).rejects.toThrow("stopped");
  });
});
