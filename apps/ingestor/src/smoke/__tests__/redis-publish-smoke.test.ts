import { decodeMarketEvent, schemaVersion } from "@meridian/proto";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeRedisClient } from "../../runtime/runtime-clients.js";
import { runRedisPublishSmoke } from "../redis-publish-smoke.js";

describe("runRedisPublishSmoke", () => {
  it("publishes a smoke trade event to the BTCUSDT trade stream", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));

    const xAdd = vi.fn<RuntimeRedisClient["xAdd"]>(async () => "1704067200000-0");

    try {
      const result = await runRedisPublishSmoke({
        connect: vi.fn(),
        close: vi.fn(),
        xAdd
      });

      expect(result).toEqual({
        stream: "market.trade.BTCUSDT",
        id: "1704067200000-0",
        eventId: "smoke:1704067200000"
      });
      expect(xAdd).toHaveBeenCalledOnce();

      const call = xAdd.mock.calls[0];
      expect(call).toBeDefined();
      if (call === undefined) {
        throw new Error("Expected Redis XADD to be called");
      }

      const [stream, id, fields] = call;
      expect(stream).toBe("market.trade.BTCUSDT");
      expect(id).toBe("*");
      expect(fields).toMatchObject({
        schemaVersion,
        kind: "trade",
        symbol: "BTCUSDT",
        eventId: "smoke:1704067200000",
        occurredAtMs: "1704067200000"
      });

      expect(fields?.payload).toBeInstanceOf(Buffer);
      const decoded = decodeMarketEvent(fields?.payload ?? Buffer.from([]));
      expect(decoded).toMatchObject({
        kind: "trade",
        symbol: "BTCUSDT",
        eventId: "smoke:1704067200000",
        occurredAtMs: 1_704_067_200_000,
        trade: {
          symbol: "BTCUSDT",
          tradeId: "smoke:1704067200000",
          eventTimeMs: 1_704_067_200_000,
          isBuyerMaker: false
        }
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
