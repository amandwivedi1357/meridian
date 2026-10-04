import { Decimal } from "@meridian/core";
import { describe, expect, it, vi } from "vitest";
import type { NormalizedMarketEvent } from "../market-events.js";
import { createSessionRecorder } from "../session-recorder.js";

function createDeps() {
  return {
    appendFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined)
  };
}

function writtenRecord(appendFile: ReturnType<typeof vi.fn>): unknown {
  const line = appendFile.mock.calls[0]?.[1];

  if (typeof line !== "string") {
    throw new Error("Expected session recorder to append a string line");
  }

  expect(line.endsWith("\n")).toBe(true);
  return JSON.parse(line);
}

describe("createSessionRecorder", () => {
  it("creates the session directory before the first append", async () => {
    const deps = createDeps();
    const recorder = createSessionRecorder("sessions/run-1/events.ndjson", deps);

    await recorder.record(createTradeEvent());

    expect(deps.mkdir).toHaveBeenCalledOnce();
    expect(deps.mkdir).toHaveBeenCalledWith("sessions/run-1", {
      recursive: true
    });
    expect(deps.appendFile).toHaveBeenCalledOnce();
  });

  it("creates the session directory only once", async () => {
    const deps = createDeps();
    const recorder = createSessionRecorder("sessions/run-1/events.ndjson", deps);

    await recorder.record(createTradeEvent("1"));
    await recorder.record(createTradeEvent("2"));

    expect(deps.mkdir).toHaveBeenCalledOnce();
    expect(deps.appendFile).toHaveBeenCalledTimes(2);
  });

  it("records trade events with decimal values as strings", async () => {
    const deps = createDeps();
    const recorder = createSessionRecorder("sessions/events.ndjson", deps);

    await recorder.record(createTradeEvent());

    expect(deps.appendFile).toHaveBeenCalledWith(
      "sessions/events.ndjson",
      expect.any(String),
      "utf8"
    );
    expect(writtenRecord(deps.appendFile)).toEqual({
      kind: "trade",
      symbol: "BTCUSDT",
      eventId: "trade-1",
      occurredAtMs: 1_700_000_000_000,
      trade: {
        symbol: "BTCUSDT",
        tradeId: "trade-1",
        price: "100.01",
        quantity: "0.001",
        eventTimeMs: 1_700_000_000_000,
        isBuyerMaker: false
      }
    });
  });

  it("records kline events with decimal values as strings", async () => {
    const deps = createDeps();
    const recorder = createSessionRecorder("sessions/events.ndjson", deps);

    await recorder.record(createKlineEvent());

    expect(writtenRecord(deps.appendFile)).toEqual({
      kind: "kline",
      symbol: "BTCUSDT",
      eventId: "1m:1700000000000",
      occurredAtMs: 1_700_000_060_000,
      candle: {
        symbol: "BTCUSDT",
        interval: "1m",
        openTimeMs: 1_700_000_000_000,
        closeTimeMs: 1_700_000_059_999,
        open: "100",
        high: "101.5",
        low: "99.5",
        close: "100.75",
        volume: "12.345",
        closed: true
      }
    });
  });

  it("records depth events with decimal levels as strings", async () => {
    const deps = createDeps();
    const recorder = createSessionRecorder("sessions/events.ndjson", deps);

    await recorder.record(createDepthEvent());

    expect(writtenRecord(deps.appendFile)).toEqual({
      kind: "depth",
      symbol: "BTCUSDT",
      eventId: "200",
      occurredAtMs: 1_700_000_000_500,
      depth: {
        firstUpdateId: 100,
        finalUpdateId: 200,
        bids: [
          {
            price: "100",
            quantity: "1.25"
          }
        ],
        asks: [
          {
            price: "101",
            quantity: "2.5"
          }
        ]
      }
    });
  });
});

function createTradeEvent(id = "trade-1"): NormalizedMarketEvent {
  return {
    kind: "trade",
    symbol: "BTCUSDT",
    eventId: id,
    occurredAtMs: 1_700_000_000_000,
    trade: {
      symbol: "BTCUSDT",
      tradeId: id,
      price: new Decimal("100.01"),
      quantity: new Decimal("0.001"),
      eventTimeMs: 1_700_000_000_000,
      isBuyerMaker: false
    }
  };
}

function createKlineEvent(): NormalizedMarketEvent {
  return {
    kind: "kline",
    symbol: "BTCUSDT",
    eventId: "1m:1700000000000",
    occurredAtMs: 1_700_000_060_000,
    candle: {
      symbol: "BTCUSDT",
      interval: "1m",
      openTimeMs: 1_700_000_000_000,
      closeTimeMs: 1_700_000_059_999,
      open: new Decimal("100"),
      high: new Decimal("101.5"),
      low: new Decimal("99.5"),
      close: new Decimal("100.75"),
      volume: new Decimal("12.345"),
      closed: true
    }
  };
}

function createDepthEvent(): NormalizedMarketEvent {
  return {
    kind: "depth",
    symbol: "BTCUSDT",
    eventId: "200",
    occurredAtMs: 1_700_000_000_500,
    depth: {
      firstUpdateId: 100,
      finalUpdateId: 200,
      bids: [
        {
          price: new Decimal("100"),
          quantity: new Decimal("1.25")
        }
      ],
      asks: [
        {
          price: new Decimal("101"),
          quantity: new Decimal("2.5")
        }
      ]
    }
  };
}
