import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"]
    },
    globals: false,
    include: ["**/*.test.ts", "tests/phase-3-5/*.test.mjs"]
  }
});
