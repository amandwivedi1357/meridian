import { describe, expect, it, vi } from "vitest";
import { Decimal, type Candle, type StrategyContext } from "@meridian/core";
import { createEmaCrossover } from "./ema-crossover.js";

const options = {
  symbol: "BTCUSDT",
  interval: "15m" as const,
  fastPeriod: 1,
  slowPeriod: 3,
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

function candleWithRange(price: number, range: number, index = 0): Candle {
  return {
    ...candle(price, index),
    high: new Decimal(price + range / 2),
    low: new Decimal(price - range / 2)
  };
}

function setup(positionQuantity = "0") {
  const strategy = createEmaCrossover(options);
  const submit = vi.fn<StrategyContext["submit"]>();
  let position = new Decimal(positionQuantity);
  const ctx: StrategyContext = {
    now: () => 0,
    position: (symbol) => ({
      symbol,
      quantity: position,
      avgEntry: new Decimal(10),
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

describe("EMA crossover strategy", () => {
  it("does not emit during warm-up or treat the first EMA comparison as a crossover", () => {
    const { feed, submit } = setup();
    feed([10, 11, 12]);
    expect(submit).not.toHaveBeenCalled();
  });

  it("buys a fixed quantity on a bullish crossover while flat", () => {
    const { feed, submit } = setup();
    feed([10, 10, 10, 12]);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: options.quantity,
      reason: "EMA bullish crossover"
    });
  });

  it("sizes bullish crossover entries from ATR risk when configured", () => {
    const strategy = createEmaCrossover({
      ...options,
      quantity: new Decimal("99"),
      atrSizing: {
        atrPeriod: 3,
        riskFraction: new Decimal("0.01"),
        stopAtrMultiple: new Decimal(2)
      }
    });
    const submit = vi.fn<StrategyContext["submit"]>();
    const ctx: StrategyContext = {
      now: () => 0,
      position: (symbol) => ({
        symbol,
        quantity: new Decimal(0),
        avgEntry: new Decimal(0),
        realizedPnl: new Decimal(0)
      }),
      balance: () => new Decimal(1000),
      submit,
      log: () => {}
    };

    [10, 10, 10, 12].forEach((price, index) =>
      strategy.onCandle?.(candleWithRange(price, 2, index), ctx)
    );

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[0].quantity.toString()).toBe("2.1428571428571428572");
  });

  it("caps ATR-sized entries by the configured maximum quantity", () => {
    const strategy = createEmaCrossover({
      ...options,
      atrSizing: {
        atrPeriod: 3,
        riskFraction: new Decimal("0.5"),
        stopAtrMultiple: new Decimal(1),
        maxQuantity: new Decimal("0.25")
      }
    });
    const submit = vi.fn<StrategyContext["submit"]>();
    const ctx: StrategyContext = {
      now: () => 0,
      position: (symbol) => ({
        symbol,
        quantity: new Decimal(0),
        avgEntry: new Decimal(0),
        realizedPnl: new Decimal(0)
      }),
      balance: () => new Decimal(1000),
      submit,
      log: () => {}
    };

    [10, 10, 10, 12].forEach((price, index) =>
      strategy.onCandle?.(candleWithRange(price, 2, index), ctx)
    );

    expect(submit.mock.calls[0]?.[0].quantity.toString()).toBe("0.25");
  });

  it("does not repeatedly buy while the fast EMA stays above the slow EMA", () => {
    const { feed, submit } = setup();
    feed([10, 10, 10, 12, 14, 16]);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("does not buy when a position is already open", () => {
    const { feed, submit } = setup("0.01");
    feed([10, 10, 10, 12]);
    expect(submit).not.toHaveBeenCalled();
  });

  it("does not short on a bearish crossover while flat", () => {
    const { feed, submit } = setup();
    feed([10, 10, 10, 8]);
    expect(submit).not.toHaveBeenCalled();
  });

  it.each(["0.005", "0.01", "0.02"])(
    "caps the sell quantity to the holding or fixed size (%s BTC)",
    (quantity) => {
      const { feed, submit } = setup(quantity);
      feed([10, 10, 10, 8, 6]);
      expect(submit).toHaveBeenCalledTimes(1);
      const intent = submit.mock.calls[0]?.[0];
      expect(intent?.side).toBe("SELL");
      expect(intent?.type).toBe("MARKET");
      expect(intent?.quantity.toString()).toBe(quantity === "0.005" ? "0.005" : "0.01");
    }
  );

  it.each([{ closed: false }, { symbol: "ETHUSDT" }, { interval: "1h" }])(
    "ignores irrelevant candles without advancing the indicators (%j)",
    (override) => {
      const { strategy, ctx, feed, submit } = setup();
      feed([10, 10]);
      strategy.onCandle?.({ ...candle(1000), ...override }, ctx);
      feed([10, 12]);
      expect(submit).toHaveBeenCalledTimes(1);
      expect(submit.mock.calls[0]?.[0].side).toBe("BUY");
    }
  );

  it("responds to a filled position before issuing the bearish exit", () => {
    const { feed, submit, setPosition } = setup();
    feed([10, 10, 10, 12]);
    setPosition("0.01");
    feed([8]);
    expect(submit.mock.calls.map(([intent]) => intent.side)).toEqual(["BUY", "SELL"]);
  });

  it("resets indicators and crossover history on initialization", async () => {
    const { strategy, ctx, feed, submit } = setup();
    feed([10, 10, 10, 12]);
    const firstRun = submit.mock.calls.map(([intent]) => ({
      ...intent,
      quantity: intent.quantity.toString()
    }));
    submit.mockClear();
    await strategy.onInit?.(ctx);
    feed([10, 10]);
    expect(submit).not.toHaveBeenCalled();
    feed([10, 12]);
    expect(
      submit.mock.calls.map(([intent]) => ({ ...intent, quantity: intent.quantity.toString() }))
    ).toEqual(firstRun);
  });

  it.each(["0", "-0.01", "NaN", "Infinity"])("rejects invalid order quantity %s", (quantity) => {
    expect(() => createEmaCrossover({ ...options, quantity: new Decimal(quantity) })).toThrow(
      "Quantity must be finite and positive"
    );
  });

  it.each([
    { atrPeriod: 0 },
    { riskFraction: new Decimal(0) },
    { riskFraction: new Decimal(1) },
    { stopAtrMultiple: new Decimal(0) },
    { maxQuantity: new Decimal(0) }
  ])("rejects invalid ATR sizing options %j", (atrSizing) => {
    expect(() =>
      createEmaCrossover({
        ...options,
        atrSizing: {
          atrPeriod: 3,
          riskFraction: new Decimal("0.01"),
          stopAtrMultiple: new Decimal(2),
          ...atrSizing
        }
      })
    ).toThrow();
  });

  it.each([
    [3, 3],
    [4, 3],
    [0, 3],
    [1, 2.5]
  ])("rejects invalid EMA periods %s / %s", (fastPeriod, slowPeriod) => {
    expect(() => createEmaCrossover({ ...options, fastPeriod, slowPeriod })).toThrow();
  });
});
