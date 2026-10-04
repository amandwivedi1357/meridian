import { Decimal } from "@meridian/core";
import { encodeMarketEvent } from "@meridian/proto";
import { createRedisXadd } from "../adapters/redis-stream-adapter.js";
import type { RuntimeRedisClient } from "../runtime/runtime-clients.js";
import { publishNormalizedMarketEvent } from "../market/market-publisher.js";
import type { NormalizedMarketEvent } from "../market/market-events.js";

export interface RedisPublishSmokeResult {
  readonly stream: string;
  readonly id: string;
  readonly eventId: string;
}

export async function runRedisPublishSmoke(
  redis: RuntimeRedisClient
): Promise<RedisPublishSmokeResult> {
  const event = createSmokeTradeEvent();

  const published = await publishNormalizedMarketEvent(event, {
    encode: encodeMarketEvent,
    xadd: createRedisXadd(redis)
  });

  return {
    stream: published.stream,
    id: published.id,
    eventId: event.eventId
  };
}

function createSmokeTradeEvent(): NormalizedMarketEvent {
  const occurredAtMs = Date.now();
  const eventId = `smoke:${occurredAtMs}`;

  return {
    kind: "trade",
    symbol: "BTCUSDT",
    eventId,
    occurredAtMs,
    trade: {
      symbol: "BTCUSDT",
      tradeId: eventId,
      price: new Decimal("100.01"),
      quantity: new Decimal("0.001"),
      eventTimeMs: occurredAtMs,
      isBuyerMaker: false
    }
  };
}
