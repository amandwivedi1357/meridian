import { describe, expect, it, vi } from "vitest";
import { createMarketDemand } from "./demand.js";
describe("market demand leases", () => {
  it("validates metadata and keeps permanent BTC subscription outside viewer leases", async () => {
    const command = vi.fn();
    const claim = createMarketDemand(command, async (symbol) => symbol === "BTCUSDT");
    const lease = await claim("BTCUSDT");
    await lease.refresh();
    await lease.release();
    expect(command).not.toHaveBeenCalled();
    await expect(claim("FAKEUSDT")).rejects.toThrow("unsupported_market_symbol");
    await expect(claim("../ETH")).rejects.toThrow("unsupported_market_symbol");
  });
  it("atomically claims, renews and releases one viewer lease", async () => {
    const command = vi.fn<(args: readonly string[]) => Promise<unknown>>(async () => 1);
    const lease = await createMarketDemand(command, async () => true)("ETHUSDT");
    await lease.refresh();
    await lease.release();
    expect(command.mock.calls[0]).toEqual(command.mock.calls[1]);
    expect(command.mock.calls[2]?.[0]?.[0]).toBe("ZREM");
  });
  it("refuses capacity and propagates transport failure", async () => {
    await expect(
      createMarketDemand(
        async () => 0,
        async () => true
      )("SOLUSDT")
    ).rejects.toThrow("market_feed_capacity");
    await expect(
      createMarketDemand(
        async () => {
          throw new Error("unavailable");
        },
        async () => true
      )("ETHUSDT")
    ).rejects.toThrow("unavailable");
  });
});
