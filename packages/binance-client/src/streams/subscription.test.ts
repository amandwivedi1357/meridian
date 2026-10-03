import { describe, expect, it } from "vitest";
import { depthStream, klineStream, tradeStream } from "./subscriptions.js";
import { chunkSubscriptions } from "./chunk-subscriptions.js";
describe("stream subscription helpers", () => {
  it("builds trade stream names", () => {
    expect(tradeStream("BTCUSDT")).toEqual({
      streamName: "btcusdt@trade"
    });
  });

  it("builds kline stream names", () => {
    expect(klineStream("ETHUSDT", "5m")).toEqual({
      streamName: "ethusdt@kline_5m"
    });
  });

  it("builds depth stream names", () => {
    expect(depthStream("BNBUSDT")).toEqual({
      streamName: "bnbusdt@depth"
    });
  });
  describe("chunkSubscriptions", () => {
  it("splits subscriptions into fixed-size chunks", () => {
    const chunks = chunkSubscriptions(
      [
        { streamName: "a" },
        { streamName: "b" },
        { streamName: "c" },
        { streamName: "d" },
        { streamName: "e" }
      ],
      2
    );

    expect(chunks).toEqual([
      [{ streamName: "a" }, { streamName: "b" }],
      [{ streamName: "c" }, { streamName: "d" }],
      [{ streamName: "e" }]
    ]);
  });

  it("returns an empty array for no subscriptions", () => {
    expect(chunkSubscriptions([], 10)).toEqual([]);
  });

  it("rejects invalid chunk sizes", () => {
    expect(() => chunkSubscriptions([{ streamName: "a" }], 0)).toThrow(
      "chunkSize must be greater than 0"
    );
  });
});
});