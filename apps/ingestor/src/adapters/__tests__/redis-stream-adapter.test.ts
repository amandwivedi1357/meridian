import { describe, expect, it, vi } from "vitest";
import { createRedisXadd } from "../redis-stream-adapter.js";

describe("createRedisXadd", () => {
  it("publishes stream fields through a redis-style xAdd client", async () => {
    const xAdd = vi.fn(async () => "1700000000000-0");
    const xadd = createRedisXadd({ xAdd });

    const id = await xadd("market.trade.BTCUSDT", "*", {
      schemaVersion: "meridian.v1",
      kind: "trade",
      symbol: "BTCUSDT",
      eventId: "12345",
      occurredAtMs: "1700000000000",
      payload: Buffer.from([1, 2, 3])
    });

    expect(id).toBe("1700000000000-0");
    expect(xAdd).toHaveBeenCalledWith("market.trade.BTCUSDT", "*", {
      schemaVersion: "meridian.v1",
      kind: "trade",
      symbol: "BTCUSDT",
      eventId: "12345",
      occurredAtMs: "1700000000000",
      payload: Buffer.from([1, 2, 3])
    });
  });
});
