import { afterEach, describe, expect, it, vi } from "vitest";
import { backtestApi } from "./backtest-api.js";
import { useTerminalStore } from "../../lib/terminal-store.js";
afterEach(() => vi.unstubAllGlobals());
describe("backtest HTTP boundary", () => {
  it("encodes run IDs and sends abortable read-only requests", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetch);
    await backtestApi.equity("job:a", -1, new AbortController().signal);
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/backtests/job%3Aa/equity?after=-1&limit=1000");
  });
  it("clears the session on expired authorization", async () => {
    useTerminalStore.getState().setSession({ role: "operator", actor: "test" }, "ready");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 401 }))
    );
    await expect(backtestApi.runs()).rejects.toThrow("401");
    expect(useTerminalStore.getState().session).toBe("required");
  });
});
