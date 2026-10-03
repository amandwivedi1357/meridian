import type { MarketEventPublisherDeps } from "../market/market-publisher.js";

export type RedisStreamFields = Parameters<MarketEventPublisherDeps["xadd"]>[2];

export interface RedisXaddClient {
  readonly xAdd: (
    stream: string,
    id: "*",
    fields: RedisStreamFields
  ) => Promise<string>;
}

export function createRedisXadd(
  client: RedisXaddClient
): MarketEventPublisherDeps["xadd"] {
  return (stream, id, fields) => client.xAdd(stream, id, fields);
}
