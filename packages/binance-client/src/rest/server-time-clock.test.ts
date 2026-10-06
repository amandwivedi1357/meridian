import { describe, expect, it, vi } from "vitest";
import { createServerTimeClock } from "./server-time-clock.js";

function setup(serverTime = 2_100) {
  let localNow = 1_000;
  const getServerTime = vi.fn(async () => {
    localNow += 200;
    return { serverTime };
  });
  const clock = createServerTimeClock({ getServerTime, nowMs: () => localNow });
  return {
    clock,
    getServerTime,
    setNow: (value: number) => {
      localNow = value;
    }
  };
}

describe("createServerTimeClock", () => {
  it("refuses timestamps before synchronization", () => {
    expect(() => setup().clock.now()).toThrow("not synchronized");
  });

  it("uses the RTT midpoint and advances using the local clock", async () => {
    const { clock, setNow } = setup();
    await clock.synchronize();
    expect(clock.now()).toBe(2_200);
    setNow(1_500);
    expect(clock.now()).toBe(2_500);
  });

  it("supports a negative server offset", async () => {
    const { clock } = setup(500);
    await clock.synchronize();
    expect(clock.now()).toBe(600);
  });

  it("floors fractional midpoint timestamps to milliseconds", async () => {
    let localNow = 1_000;
    const clock = createServerTimeClock({
      nowMs: () => localNow,
      getServerTime: async () => {
        localNow = 1_003;
        return { serverTime: 2_000 };
      }
    });
    await clock.synchronize();
    expect(clock.now()).toBe(2_001);
  });

  it("expires at the freshness boundary and can resynchronize", async () => {
    const { clock, setNow } = setup();
    await clock.synchronize();
    setNow(61_199);
    expect(clock.now()).toBe(62_199);
    setNow(61_200);
    expect(() => clock.now()).toThrow("requires resynchronization");
    await clock.synchronize();
    expect(clock.now()).toBe(2_200);
  });

  it("invalidates synchronization when the local clock moves backwards", async () => {
    const { clock, setNow } = setup();
    await clock.synchronize();
    setNow(1_500);
    clock.now();
    setNow(1_400);
    expect(() => clock.now()).toThrow("requires resynchronization");
    expect(() => clock.now()).toThrow("not synchronized");
  });

  it("deduplicates concurrent synchronization requests", async () => {
    const { clock, getServerTime } = setup();
    await Promise.all([clock.synchronize(), clock.synchronize()]);
    expect(getServerTime).toHaveBeenCalledTimes(1);
  });

  it("fails closed after a refresh error and permits a later retry", async () => {
    const { clock, getServerTime } = setup();
    await clock.synchronize();
    getServerTime.mockRejectedValueOnce(new Error("Offline"));
    await expect(clock.synchronize()).rejects.toThrow("Offline");
    expect(() => clock.now()).toThrow("not synchronized");
    await clock.synchronize();
    expect(clock.now()).toBe(2_200);
  });

  it.each([999, 2_001])("rejects invalid RTT ending at %i", async (receivedAt) => {
    let localNow = 1_000;
    const clock = createServerTimeClock({
      nowMs: () => localNow,
      getServerTime: async () => {
        localNow = receivedAt;
        return { serverTime: 2_000 };
      }
    });
    await expect(clock.synchronize()).rejects.toThrow("invalid round-trip");
    expect(() => clock.now()).toThrow("not synchronized");
  });

  it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid server timestamp %s",
    async (value) => {
      await expect(setup(value).clock.synchronize()).rejects.toThrow("Timestamp");
    }
  );

  it.each([0, -1, 0.5, NaN, Infinity])("rejects invalid limits %s", (value) => {
    const getServerTime = async () => ({ serverTime: 1_000 });
    expect(() => createServerTimeClock({ getServerTime, maxAgeMs: value })).toThrow("Clock limits");
    expect(() => createServerTimeClock({ getServerTime, maxRoundTripMs: value })).toThrow(
      "Clock limits"
    );
  });
});
