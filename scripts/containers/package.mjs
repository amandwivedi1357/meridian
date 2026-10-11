import { readFile, writeFile, readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const service = process.argv[2];
if (!["api", "ingestor", "engine", "executor", "backtest-worker"].includes(service)) {
  throw new Error("Unsupported container service");
}
function pnpm(args) {
  const result = spawnSync("pnpm", args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error("Container packaging command failed");
}
pnpm(["--filter", `@meridian/${service}...`, "-r", "build"]);

async function clean(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await clean(child);
    else if (/\.(test|spec)\./.test(entry.name)) await rm(child);
  }
}
// Only builder manifests are rewritten; the repository manifests stay unchanged.
for (const root of ["apps", "packages"]) {
  for (const name of await readdir(root)) {
    const path = join(root, name, "package.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.files = ["dist", "package.json"];
    await writeFile(path, JSON.stringify(manifest));
    try {
      await clean(join(root, name, "dist"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
pnpm(["--filter", `@meridian/${service}`, "deploy", "--prod", "/out"]);
