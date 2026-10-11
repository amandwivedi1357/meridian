import { Decimal } from "@meridian/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMarketIngestor } from "../market-ingestor-factory.js";
import type { TradeRow, KlineRow } from "../market-batch-writer.js";

const input = (id: number) => ({
  e: "trade",
  E: 1700000000000,
  T: 1700000000000,
  s: "BTCUSDT",
  t: id,
  p: "100",
  q: "0.1",
  m: false,
  M: true
});
function setup(capacity = 100) {
  const deps = {
    xadd: vi.fn(async () => "1-0"),
    upsertTrades: vi.fn<(rows: readonly TradeRow[]) => Promise<void>>(async () => {}),
    upsertKlines: vi.fn<(rows: readonly KlineRow[]) => Promise<void>>(async () => {})
  };
  return {
    deps,
    ingestor: createMarketIngestor({
      ...deps,
      buffer: { capacity, batchSize: Math.min(64, capacity), flushMs: 5 }
    })
  };
}
describe("bounded buffered market ingestion", () => {
  afterEach(() => vi.useRealTimers());
  it("publishes concurrently but resolves only after durable coalesced persistence", async () => {
    vi.useFakeTimers();
    const { deps, ingestor } = setup();
    let release!: () => void;
    deps.upsertTrades.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const first = ingestor.ingest(input(1));
    const second = ingestor.ingest(input(2));
    const resolved = vi.fn();
    void first.then(resolved);
    await vi.advanceTimersByTimeAsync(5);
    expect(deps.xadd).toHaveBeenCalledTimes(2);
    expect(deps.upsertTrades).toHaveBeenCalledOnce();
    expect(deps.upsertTrades.mock.calls[0]![0]).toHaveLength(2);
    expect(resolved).not.toHaveBeenCalled();
    release();
    const results = await Promise.all([first, second]);
    expect(results.map((result) => result.batchWriteResult.tradesWritten)).toEqual([1, 1]);
    await ingestor.drain!();
  });
  it("rejects capacity overflow before publication", async () => {
    const { deps, ingestor } = setup(2);
    let release!: () => void;
    deps.upsertTrades.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const accepted = [ingestor.ingest(input(1)), ingestor.ingest(input(2))];
    await expect(ingestor.ingest(input(3))).rejects.toThrow("ingestor_capacity");
    expect(deps.xadd).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(release).toBeDefined());
    release();
    await Promise.all(accepted);
    await ingestor.drain!();
  });
  it("drains publishes still in flight and refuses new work", async () => {
    const { deps, ingestor } = setup();
    let release!: (id: string) => void;
    deps.xadd.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        })
    );
    const accepted = ingestor.ingest(input(1));
    const drain = ingestor.drain!();
    await expect(ingestor.ingest(input(2))).rejects.toThrow("ingestor_draining");
    release("1-0");
    await drain;
    await expect(accepted).resolves.toMatchObject({ batchWriteResult: { tradesWritten: 1 } });
    expect(deps.upsertTrades).toHaveBeenCalledOnce();
  });
  it("flushes a partial batch on its bounded timer", async () => {
    vi.useFakeTimers();
    const { deps, ingestor } = setup();
    const work = ingestor.ingest(input(1));
    await vi.advanceTimersByTimeAsync(4);
    expect(deps.upsertTrades).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await work;
    expect(deps.upsertTrades).toHaveBeenCalledOnce();
    await ingestor.drain!();
  });
  it("latches persistence failure, rejects affected work and never acknowledges it", async () => {
    const { deps, ingestor } = setup();
    deps.upsertTrades.mockRejectedValue(new Error("database unavailable"));
    const works = [ingestor.ingest(input(1)), ingestor.ingest(input(2))];
    const settled = Promise.allSettled(works);
    await expect(ingestor.drain!()).rejects.toThrow("database unavailable");
    expect((await settled).every((result) => result.status === "rejected")).toBe(true);
    await expect(ingestor.ingest(input(3))).rejects.toThrow("ingestor_draining");
    expect(deps.xadd).toHaveBeenCalledTimes(2);
  });
  it("does not persist a failed Redis publication", async () => {
    const { deps, ingestor } = setup();
    deps.xadd.mockRejectedValue(new Error("redis unavailable"));
    await expect(ingestor.ingest(input(1))).rejects.toThrow("redis unavailable");
    await expect(ingestor.ingest(input(2))).rejects.toThrow("redis unavailable");
    expect(deps.xadd).toHaveBeenCalledOnce();
    expect(deps.upsertTrades).not.toHaveBeenCalled();
    await expect(ingestor.drain!()).rejects.toThrow("redis unavailable");
  });
  it("coalesces duplicate trades with correct per-event metrics", async () => {
    const { deps, ingestor } = setup();
    const works = [
      ingestor.ingest(input(1)),
      ingestor.ingest(input(1)),
      ingestor.ingest({ ...input(1), E: input(1).E + 1 })
    ];
    await ingestor.drain!();
    expect((await Promise.all(works)).map((result) => result.batchWriteResult)).toEqual([
      { tradesWritten: 0, klinesWritten: 0, duplicatesSkipped: 1 },
      { tradesWritten: 1, klinesWritten: 0, duplicatesSkipped: 0 },
      { tradesWritten: 1, klinesWritten: 0, duplicatesSkipped: 0 }
    ]);
    expect(deps.upsertTrades.mock.calls[0]![0]).toHaveLength(2);
  });
  it("keeps the latest candle and never coalesces a closed candle back to open", async () => {
    const { deps, ingestor } = setup();
    const candle = (eventTime: number, close: string, closed: boolean) => ({
      e: "kline",
      E: eventTime,
      s: "BTCUSDT",
      k: {
        t: 1700000000000,
        T: 1700000059999,
        s: "BTCUSDT",
        i: "1m",
        f: 1,
        L: 2,
        o: "100",
        c: close,
        h: "110",
        l: "90",
        v: "1",
        n: 2,
        x: closed,
        q: "100",
        V: "0.5",
        Q: "50",
        B: "0"
      }
    });
    const works = [
      ingestor.ingest(candle(1, "101", false)),
      ingestor.ingest(candle(3, "103", true)),
      ingestor.ingest(candle(2, "102", false))
    ];
    await ingestor.drain!();
    await Promise.all(works);
    expect(deps.upsertKlines).toHaveBeenCalledWith([
      expect.objectContaining({
        close: new Decimal("103"),
        closed: true
      })
    ]);
  });
  it("publishes depth without pretending it is persisted to Timescale", async () => {
    const { deps, ingestor } = setup();
    const result = await ingestor.ingest({
      e: "depthUpdate",
      E: 1,
      s: "BTCUSDT",
      U: 1,
      u: 2,
      b: [],
      a: []
    });
    expect(result.batchWriteResult).toEqual({
      tradesWritten: 0,
      klinesWritten: 0,
      duplicatesSkipped: 0
    });
    expect(deps.upsertTrades).not.toHaveBeenCalled();
    expect(deps.upsertKlines).not.toHaveBeenCalled();
    await ingestor.drain!();
  });
  it("refuses invalid bounds and concurrent recording", () => {
    const { deps } = setup();
    expect(() =>
      createMarketIngestor({ ...deps, buffer: { capacity: 2, batchSize: 3, flushMs: 1 } })
    ).toThrow("invalid_ingest_buffer");
    expect(() =>
      createMarketIngestor({
        ...deps,
        buffer: { capacity: 2, batchSize: 2, flushMs: 1 },
        sessionRecorder: { record: async () => {} }
      })
    ).toThrow("buffered_ingest_recorder_not_supported");
  });
});
