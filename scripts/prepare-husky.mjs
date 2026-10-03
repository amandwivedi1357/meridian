import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

if (!existsSync(".git")) {
  console.log("Skipping Husky install because .git is not initialized.");
  process.exit(0);
}

const result = spawnSync("git", ["config", "core.hooksPath", ".husky"], {
  shell: true,
  stdio: "inherit"
});
process.exit(result.status ?? 1);
