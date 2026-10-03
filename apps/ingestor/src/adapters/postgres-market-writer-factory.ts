import type { PostgresLikeClient } from "@meridian/db";
import {
  createTimescaleMarketWriter,
  type TimescaleMarketWriter
} from "./timescale-market-writer.js";

export function createPostgresMarketWriter(
  client: PostgresLikeClient
): TimescaleMarketWriter {
  return createTimescaleMarketWriter({
    async execute(query) {
      await client.query(query.text, query.values);
    }
  });
}