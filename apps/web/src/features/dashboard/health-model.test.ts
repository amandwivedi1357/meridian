import { describe, expect, it } from "vitest";
import { age, parseHealth, sampleFresh } from "./health-model.js";
const health = () => ({
  checkedAt: 10000,
  redis: "available",
  database: "unavailable",
  streams: [
    {
      stream: "signals",
      status: "available",
      length: 3,
      groups: [{ name: "executor", consumers: 0, pending: 1, lag: null }]
    }
  ]
});
describe("health presentation", () => {
  it("preserves empty groups, zero counts and unknown lag", () => {
    const result = parseHealth(health());
    expect(result.streams[0]?.groups[0]?.lag).toBeNull();
    expect(result.streams[0]?.groups[0]?.consumers).toBe(0);
  });
  it("rejects malformed and oversized observations", () => {
    expect(() => parseHealth({ ...health(), checkedAt: -1 })).toThrow();
    expect(() =>
      parseHealth({ ...health(), streams: Array(8).fill(health().streams[0]) })
    ).toThrow();
    expect(() => parseHealth({ ...health(), redis: "healthy" })).toThrow();
    const invalid = health();
    invalid.streams[0]!.groups[0]!.pending = -1;
    expect(() => parseHealth(invalid)).toThrow();
  });
  it("marks old or future samples stale instead of retaining healthy labels", () => {
    const value = parseHealth(health());
    expect(sampleFresh(value, 25000)).toBe(true);
    expect(sampleFresh(value, 25001)).toBe(false);
    expect(sampleFresh(value, 0)).toBe(false);
    expect(sampleFresh(null, 10000)).toBe(false);
  });
  it("formats elapsed age, missing data and bounded clock skew", () => {
    expect(age(null, 10000)).toBe("--");
    expect(age(10000, 12000)).toBe("2s");
    expect(age(0, 61000)).toBe("1m 1s");
    expect(age(0, 3660000)).toBe("1h 1m");
    expect(age(20000, 10000)).toBe("--");
    expect(age(11000, 10000)).toBe("0s");
  });
});
