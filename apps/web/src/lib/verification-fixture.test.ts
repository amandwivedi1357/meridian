import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("verification fixture imports", () => {
  it("does not register another API startup listener when imported by a fixture worker", () => {
    const root = fileURLToPath(new URL("../../../../", import.meta.url));
    const output = execFileSync(
      process.execPath,
      [
        "-e",
        `
      process.argv.push('--fixture');
      const before = process.listenerCount('message');
      const helper = require('./apps/web/scripts/verify-recovery.cjs');
      console.log(JSON.stringify({ addedListeners: process.listenerCount('message') - before, exported: typeof helper.fixture }));
    `
      ],
      { cwd: root, encoding: "utf8", timeout: 5000 }
    );
    expect(JSON.parse(output.trim())).toEqual({ addedListeners: 0, exported: "function" });
  });
});
