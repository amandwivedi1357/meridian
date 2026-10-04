import { describe, expect, it } from "vitest";
import { Decimal } from "@meridian/core";
import { createEma } from "./ema.js";

describe("createEma", () => {
  it("waits for a full period and seeds with the simple average", () => {
    const ema = createEma(3);
    expect(ema.update(new Decimal(10))).toBeNull();
    expect(ema.update(new Decimal(20))).toBeNull();
    expect(ema.update(new Decimal(30))?.toString()).toBe("20");
  });

  it("matches known EMA values after warm-up", () => {
    const ema = createEma(3);
    const values = [10, 20, 30, 40, 20, 10].map(
      (price) => ema.update(new Decimal(price))?.toString() ?? null
    );
    expect(values).toEqual([null, null, "20", "30", "25", "17.5"]);
  });

  it("uses the requested period's weighting", () => {
    const ema = createEma(4);
    for (const price of [2, 4, 6]) expect(ema.update(new Decimal(price))).toBeNull();
    expect(ema.update(new Decimal(8))?.toString()).toBe("5");
    expect(ema.update(new Decimal(10))?.toString()).toBe("7");
  });

  it("returns each input immediately for a period of one", () => {
    const ema = createEma(1);
    for (const price of ["0.1", "0.2", "0.3"]) {
      expect(ema.update(new Decimal(price))?.toString()).toBe(price);
    }
  });

  it("preserves decimal arithmetic during initialization and updates", () => {
    const ema = createEma(3);
    ema.update(new Decimal("0.1"));
    ema.update(new Decimal("0.2"));
    expect(ema.update(new Decimal("0.3"))?.toString()).toBe("0.2");
    expect(ema.update(new Decimal("0.4"))?.toString()).toBe("0.3");
    expect(ema.update(new Decimal("0.2"))?.toString()).toBe("0.25");
  });

  it("keeps separate instances independent", () => {
    const first = createEma(2);
    const second = createEma(2);
    expect(first.update(new Decimal(10))).toBeNull();
    expect(second.update(new Decimal(100))).toBeNull();
    expect(first.update(new Decimal(20))?.toString()).toBe("15");
    expect(second.update(new Decimal(200))?.toString()).toBe("150");
  });

  it.each([0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid period %s",
    (period) => {
      expect(() => createEma(period)).toThrow("EMA period must be a positive integer");
    }
  );
});
