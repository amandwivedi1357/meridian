import { Decimal } from "@meridian/core";
import { describe, expect, it, vi } from "vitest";
import { createTimescaleMarketWriter } from "../timescale-market-writer.js";

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

describe("createTimescaleMarketWriter", () => {
  it("upserts trade rows with decimal values serialized as strings", async () => {
    let executedQuery:
      Parameters<Parameters<typeof createTimescaleMarketWriter>[0]["execute"]>[0] | undefined;
    const execute = vi.fn(async (query: NonNullable<typeof executedQuery>) => {
      executedQuery = query;
    });
    const writer = createTimescaleMarketWriter({ execute });

    await writer.upsertTrades([
      {
        symbol: "BTCUSDT",
        eventId: "12345",
        tradeId: "12345",
        eventTimeMs: 1_700_000_000_000,
        price: new Decimal("100.10000001"),
        quantity: new Decimal("0.02000003"),
        isBuyerMaker: true
      }
    ]);

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({
      text: expect.stringContaining("INSERT INTO trades"),
      values: [
        "BTCUSDT",
        "12345",
        "12345",
        new Date(1_700_000_000_000),
        "100.10000001",
        "0.02000003",
        true
      ]
    });
    expect(normalizeSql(executedQuery?.text ?? "")).toContain(
      "ON CONFLICT (symbol, event_id, event_time)"
    );
  });

  it("upserts multiple trade rows in one SQL statement", async () => {
    const execute = vi.fn(async () => undefined);
    const writer = createTimescaleMarketWriter({ execute });

    await writer.upsertTrades([
      {
        symbol: "BTCUSDT",
        eventId: "12345",
        tradeId: "12345",
        eventTimeMs: 1_700_000_000_000,
        price: new Decimal("100.10"),
        quantity: new Decimal("0.02"),
        isBuyerMaker: true
      },
      {
        symbol: "ETHUSDT",
        eventId: "54321",
        tradeId: "54321",
        eventTimeMs: 1_700_000_000_500,
        price: new Decimal("2000.25"),
        quantity: new Decimal("0.5"),
        isBuyerMaker: false
      }
    ]);

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({
      text: expect.stringContaining(
        "VALUES ($1, $2, $3, $4, $5, $6, $7), ($8, $9, $10, $11, $12, $13, $14)"
      ),
      values: [
        "BTCUSDT",
        "12345",
        "12345",
        new Date(1_700_000_000_000),
        "100.1",
        "0.02",
        true,
        "ETHUSDT",
        "54321",
        "54321",
        new Date(1_700_000_000_500),
        "2000.25",
        "0.5",
        false
      ]
    });
  });

  it("upserts kline rows with decimal values serialized as strings", async () => {
    let executedQuery:
      Parameters<Parameters<typeof createTimescaleMarketWriter>[0]["execute"]>[0] | undefined;
    const execute = vi.fn(async (query: NonNullable<typeof executedQuery>) => {
      executedQuery = query;
    });
    const writer = createTimescaleMarketWriter({ execute });

    await writer.upsertKlines([
      {
        symbol: "ETHUSDT",
        eventId: "1m:1700000000000",
        interval: "1m",
        openTimeMs: 1_700_000_000_000,
        closeTimeMs: 1_700_000_059_999,
        open: new Decimal("2000.00"),
        high: new Decimal("2002.50"),
        low: new Decimal("1999.75"),
        close: new Decimal("2001.25"),
        volume: new Decimal("12.345"),
        closed: true
      }
    ]);

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({
      text: expect.stringContaining("INSERT INTO klines"),
      values: [
        "ETHUSDT",
        "1m:1700000000000",
        "1m",
        new Date(1_700_000_000_000),
        new Date(1_700_000_059_999),
        "2000",
        "2002.5",
        "1999.75",
        "2001.25",
        "12.345",
        true
      ]
    });
    expect(executedQuery?.text).toContain("ON CONFLICT (symbol, interval, open_time)");
  });

  it("upserts multiple kline rows in one SQL statement", async () => {
    const execute = vi.fn(async () => undefined);
    const writer = createTimescaleMarketWriter({ execute });

    await writer.upsertKlines([
      {
        symbol: "ETHUSDT",
        eventId: "1m:1700000000000",
        interval: "1m",
        openTimeMs: 1_700_000_000_000,
        closeTimeMs: 1_700_000_059_999,
        open: new Decimal("2000.00"),
        high: new Decimal("2002.50"),
        low: new Decimal("1999.75"),
        close: new Decimal("2001.25"),
        volume: new Decimal("12.345"),
        closed: true
      },
      {
        symbol: "BTCUSDT",
        eventId: "1m:1700000060000",
        interval: "1m",
        openTimeMs: 1_700_000_060_000,
        closeTimeMs: 1_700_000_119_999,
        open: new Decimal("100.00"),
        high: new Decimal("101.00"),
        low: new Decimal("99.50"),
        close: new Decimal("100.75"),
        volume: new Decimal("2.5"),
        closed: false
      }
    ]);

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({
      text: expect.stringContaining(
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11), ($12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)"
      ),
      values: [
        "ETHUSDT",
        "1m:1700000000000",
        "1m",
        new Date(1_700_000_000_000),
        new Date(1_700_000_059_999),
        "2000",
        "2002.5",
        "1999.75",
        "2001.25",
        "12.345",
        true,
        "BTCUSDT",
        "1m:1700000060000",
        "1m",
        new Date(1_700_000_060_000),
        new Date(1_700_000_119_999),
        "100",
        "101",
        "99.5",
        "100.75",
        "2.5",
        false
      ]
    });
  });

  it("does not execute SQL for empty batches", async () => {
    const execute = vi.fn(async () => undefined);
    const writer = createTimescaleMarketWriter({ execute });

    await writer.upsertTrades([]);
    await writer.upsertKlines([]);

    expect(execute).not.toHaveBeenCalled();
  });
});
