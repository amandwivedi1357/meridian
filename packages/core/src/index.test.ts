import { describe, expect, it } from "vitest";
import { Decimal } from "./index.js";

describe("Decimal money math", () => {
  it("does not use binary floating point behavior", () => {
    expect(new Decimal("0.1").plus("0.2").toString()).toBe("0.3");
  });
});
