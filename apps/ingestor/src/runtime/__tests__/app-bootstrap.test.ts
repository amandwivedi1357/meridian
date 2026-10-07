import { decodeMarketEvent } from "@meridian/proto";
import { Registry } from "prom-client";
import { describe, expect, it, vi } from "vitest";
import type { RedisStreamFields } from "../../adapters/redis-stream-adapter.js";
import { createIngestorApp } from "../app-bootstrap.js";

describe("createIngestorApp", () => {
  it("runs startup migrations before ingesting market events", async () => {
    let publishedFields: RedisStreamFields | undefined;
    const redis = {
      xAdd: vi.fn(async (_stream: string, _id: "*", fields: RedisStreamFields) => {
        publishedFields = fields;
        return "1700000000000-0";
      })
    };
    const postgres = {
      query: vi.fn(async () => ({ rows: [] }))
    };
    const sessionRecorder = {
      record: vi.fn(async () => undefined)
    };
    const app = createIngestorApp({ redis, postgres, sessionRecorder });

    const startResult = await app.start();
    const ingestResult = await app.ingest({
      e: "trade",
      E: 1_700_000_000_000,
      s: "BTCUSDT",
      t: 12345,
      p: "100.10",
      q: "0.0200",
      b: 1,
      a: 2,
      T: 1_700_000_000_001,
      m: true,
      M: true
    });

    expect(startResult.applied).toEqual([
      "001_market_data_schema",
      "002_backtest_results_schema",
      "003_live_order_write_ahead_schema"
    ]);
    expect(postgres.query).toHaveBeenCalledWith(
      expect.stringContaining("CREATE TABLE IF NOT EXISTS orders"),
      []
    );
    expect(postgres.query).toHaveBeenCalledWith(
      expect.stringContaining("CREATE TABLE IF NOT EXISTS backtest_runs"),
      []
    );
    expect(postgres.query).toHaveBeenCalledWith(
      expect.stringContaining("CREATE TABLE IF NOT EXISTS trades"),
      []
    );
    expect(redis.xAdd).toHaveBeenCalledOnce();
    expect(sessionRecorder.record).toHaveBeenCalledOnce();
    expect(ingestResult.publishResult.stream).toBe("market.trade.BTCUSDT");

    const decoded = decodeMarketEvent(publishedFields?.payload ?? Buffer.from([]));

    expect(decoded.kind).toBe("trade");
  });

  it("records ingestor metrics when a registry is provided", async () => {
    const registry = new Registry();
    const redis = {
      xAdd: vi.fn(async () => "1700000000000-0")
    };
    const postgres = {
      query: vi.fn(async () => ({ rows: [] }))
    };
    const app = createIngestorApp({ redis, postgres, metricsRegistry: registry });

    await app.ingest({
      e: "trade",
      E: 1_700_000_000_000,
      s: "BTCUSDT",
      t: 12345,
      p: "100.10",
      q: "0.0200",
      b: 1,
      a: 2,
      T: 1_700_000_000_001,
      m: true,
      M: true
    });

    const metrics = await registry.metrics();

    expect(metrics).toContain('ingestor_events_processed_total{kind="trade"} 1');
    expect(metrics).toContain('ingestor_events_published_total{stream="market.trade.BTCUSDT"} 1');
    expect(metrics).toContain('ingestor_events_persisted_total{target="trades"} 1');
  });
});
