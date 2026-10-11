import { Registry } from "prom-client";
import { describe, expect, it, vi } from "vitest";
import { createBinanceMetricsFetch } from "./binance-http-metrics.js";

describe("Binance metrics fetch", () => {
  it("preserves response/request and excludes credentials, URLs and bodies from metrics", async () => {
    const registry = new Registry();
    const response = new Response('{"secret":"private-body"}', {
      status: 429,
      headers: { "X-MBX-USED-WEIGHT-1M": "42" }
    });
    const request = vi.fn<typeof fetch>().mockResolvedValue(response);
    const monitored = createBinanceMetricsFetch(registry, request);
    const url = new URL(
      "https://testnet.binance.vision/api/v3/order?signature=private-signature&newClientOrderId=private-id"
    );
    const init = {
      method: "POST",
      headers: { "X-MBX-APIKEY": "private-key" },
      signal: new AbortController().signal
    };
    expect(await monitored(url, init)).toBe(response);
    expect(request).toHaveBeenCalledWith(url, init);
    expect(response.bodyUsed).toBe(false);
    const metrics = await registry.metrics();
    expect(metrics).toContain('binance_http_status_total{environment="testnet",code="429"} 1');
    expect(metrics).toContain('binance_used_weight{environment="testnet"} 42');
    expect(metrics).toContain('meridian_binance_throttle_timestamp_seconds{environment="testnet"}');
    expect(metrics).not.toMatch(/private-|signature|apiKey|\/api\/v3/);
  });
  it("clears missing/invalid weight, distinguishes transport errors and leaves unrelated fetches alone", async () => {
    const registry = new Registry();
    const error = new Error("private-signature");
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { headers: { "x-mbx-used-weight-1m": "4" } }))
      .mockResolvedValueOnce(
        new Response("{}", { headers: { "x-mbx-used-weight-1m": "not-a-number" } })
      )
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(new Response("{}"));
    const monitored = createBinanceMetricsFetch(registry, request);
    await monitored("https://api.binance.com/api/v3/time");
    await monitored("https://api.binance.com/api/v3/time");
    expect(await registry.metrics()).not.toContain("binance_used_weight{");
    await expect(monitored("https://api.binance.com/api/v3/time")).rejects.toBe(error);
    const before = await registry.metrics();
    await monitored("https://unrelated.example.test/");
    expect(await registry.metrics()).toBe(before);
    expect(before).toContain('binance_transport_errors_total{environment="production"} 1');
    expect(before).not.toContain("private-signature");
  });
});
