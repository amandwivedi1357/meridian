import { describe, expect, it, vi } from "vitest";
import { Decimal, type Candle, type StrategyContext } from "@meridian/core";
import {
  createGridMeanReversion,
  type GridMeanReversionOptions
} from "./grid-mean-reversion.js";

const options = {
  symbol: "BTCUSDT",
  interval: "15m" as const,
  lookbackPeriod: 3,
  gridStepPct: new Decimal(5),
  quantity: new Decimal("0.01")
};

function candle(price: number, index = 0): Candle {
  return {
    symbol: "BTCUSDT",
    interval: "15m",
    openTimeMs: index * 900000,
    closeTimeMs: (index + 1) * 900000 - 1,
    open: new Decimal(price),
    high: new Decimal(price),
    low: new Decimal(price),
    close: new Decimal(price),
    volume: new Decimal(1),
    closed: true
  };
}

function setup(positionQuantity = "0", override: Partial<GridMeanReversionOptions> = {}) {
  const strategy = createGridMeanReversion({ ...options, ...override });
  const submit = vi.fn<StrategyContext["submit"]>();
  let position = new Decimal(positionQuantity);
  const ctx: StrategyContext = {
    now: () => 0,
    position: (symbol) => ({
      symbol,
      quantity: position,
      avgEntry: new Decimal(100),
      realizedPnl: new Decimal(0)
    }),
    balance: () => new Decimal(1000),
    submit,
    log: () => {}
  };
  function feed(prices: number[]) {
    prices.forEach((price, index) => strategy.onCandle?.(candle(price, index), ctx));
  }
  return {
    strategy,
    ctx,
    submit,
    feed,
    setPosition: (quantity: string) => {
      position = new Decimal(quantity);
    }
  };
}

describe("grid mean-reversion strategy", () => {
  it("does not emit while the mean is warming up", () => {
    const { feed, submit } = setup();
    feed([100, 100]);
    expect(submit).not.toHaveBeenCalled();
  });

  it("buys when the close is below the lower grid threshold", () => {
    const { feed, submit } = setup();
    feed([100, 100, 80]);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: options.quantity,
      reason: "Grid mean-reversion buy"
    });
  });

  it("does not buy when price has not moved below the lower threshold", () => {
    const { feed, submit } = setup();
    feed([100, 100, 98]);
    expect(submit).not.toHaveBeenCalled();
  });

  it("caps buy quantity to the remaining max position", () => {
    const { feed, submit } = setup("0.015", {
      maxPosition: new Decimal("0.02")
    });
    feed([100, 100, 80]);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[0].quantity.toString()).toBe("0.005");
  });

  it("does not buy once max position is already reached", () => {
    const { feed, submit } = setup("0.02", {
      maxPosition: new Decimal("0.02")
    });
    feed([100, 100, 80]);
    expect(submit).not.toHaveBeenCalled();
  });

  it("sells when the close is above the upper grid threshold", () => {
    const { feed, submit } = setup("0.01");
    feed([100, 100, 120]);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      side: "SELL",
      type: "MARKET",
      quantity: options.quantity,
      reason: "Grid mean-reversion sell"
    });
  });

  it("caps sell quantity to the current holding", () => {
    const { feed, submit } = setup("0.005");
    feed([100, 100, 120]);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[0].quantity.toString()).toBe("0.005");
  });

  it.each([{ closed: false }, { symbol: "ETHUSDT" }, { interval: "1h" }])(
    "ignores irrelevant candles without advancing the mean (%j)",
    (override) => {
      const { strategy, ctx, feed, submit } = setup();
      feed([100, 100]);
      strategy.onCandle?.({ ...candle(1000), ...override }, ctx);
      feed([80]);

      expect(submit).toHaveBeenCalledTimes(1);
      expect(submit.mock.calls[0]?.[0].side).toBe("BUY");
    }
  );

  it("resets the mean on initialization", async () => {
    const { strategy, ctx, feed, submit } = setup();
    feed([100, 100, 80]);
    expect(submit).toHaveBeenCalledTimes(1);

    submit.mockClear();
    await strategy.onInit?.(ctx);
    feed([100, 100]);
    expect(submit).not.toHaveBeenCalled();
    feed([80]);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it.each([
    { lookbackPeriod: 0 },
    { lookbackPeriod: 2.5 },
    { gridStepPct: new Decimal(0) },
    { gridStepPct: new Decimal("NaN") },
    { quantity: new Decimal(0) },
    { quantity: new Decimal("Infinity") },
    { maxPosition: new Decimal(0) }
  ])("rejects invalid options %j", (override) => {
    expect(() => createGridMeanReversion({ ...options, ...override })).toThrow();
  });
});
