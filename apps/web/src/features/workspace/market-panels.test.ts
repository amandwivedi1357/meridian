import { it, expect } from "vitest";
import { depthRows } from "./MarketPanels.js";
it("keeps nearest depth bounded and cumulative totals decimal-exact", () => {
  const rows = depthRows(
    Array.from({ length: 20 }, (_, i) => ({ price: String(100 + i), quantity: "0.1" }))
  );
  expect(rows).toHaveLength(8);
  expect(rows.at(-1)?.total).toBe("0.8");
  expect(depthRows([])).toEqual([]);
});
