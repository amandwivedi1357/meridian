const { test } = require("node:test");
const assert = require("node:assert/strict");
const { distribution } = require("./verify-ingest-repeats.cjs");

test("aggregates every measured run without discarding the worst result", () => {
  assert.deepEqual(distribution([30, 5, 20]), { median: 20, min: 5, max: 30 });
  assert.deepEqual(distribution([10, 8, 4, 2]), { median: 6, min: 2, max: 10 });
});
test("refuses incomplete or nonfinite metric arrays", () => {
  for (const input of [[], [NaN], [Infinity], [1, undefined]])
    assert.throws(() => distribution(input));
});
