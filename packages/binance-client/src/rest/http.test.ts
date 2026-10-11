import { afterEach, describe, expect, it, vi } from "vitest";
import { httpGetJson } from "./http.js";

afterEach(() => vi.unstubAllGlobals());
describe("bounded public market HTTP requests", () => {
  it("passes a deadline signal and does not retry a timeout", async () => {
    const fetch = vi.fn().mockRejectedValue(new DOMException("deadline", "TimeoutError"));
    vi.stubGlobal("fetch", fetch);
    await expect(
      httpGetJson({ baseUrl: "https://example.test", path: "/depth", timeoutMs: 3000 })
    ).rejects.toThrow("deadline");
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
  });
});
