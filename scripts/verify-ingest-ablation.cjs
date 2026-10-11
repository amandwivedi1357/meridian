/* global __dirname */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { distribution } = require("./verify-ingest-repeats.cjs");
const root = path.resolve(__dirname, "..");
const modes = ["full", "no-db", "no-redis", "normalize-only"];

function summarize(runs) {
  return Object.fromEntries(
    modes.map((mode) => {
      const selected = runs.filter((run) => run.ablation === mode);
      const measured = selected.filter((run) => !run.invalid);
      return [
        mode,
        {
          runs: selected,
          complete: measured.length === 3,
          allFixtureChecksPass: measured.length === 3 && measured.every((run) => run.fixturePassed),
          statistics: measured.length
            ? Object.fromEntries(
                [
                  "checkpointP95Ms",
                  "checkpointP99Ms",
                  "operationP95Ms",
                  "operationP99Ms",
                  "capacityRefused",
                  "unscheduledEvents"
                ].map((key) => [key, distribution(measured.map((run) => run[key]))])
              )
            : null
        }
      ];
    })
  );
}

async function main() {
  const id = randomUUID();
  const output = path.join(root, "logs/verification/phase-5", `ablation-${id}`);
  await fs.mkdir(output, { recursive: true });
  const runs = [];
  // Interleave variants so one mode does not always benefit from an earlier/cooler host.
  for (let repetition = 0; repetition < 3; repetition++) {
    const order = [...modes.slice(repetition), ...modes.slice(0, repetition)];
    for (const ablation of order) {
      const variant = `ablation-${id}-${ablation}-${repetition + 1}`;
      console.log(`Starting ${ablation}, repetition ${repetition + 1}/3`);
      const child = spawn(
        process.execPath,
        [path.join(root, "scripts/verify-ingest-benchmark.cjs")],
        {
          cwd: root,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            BENCHMARK_VARIANT: variant,
            BENCHMARK_ABLATION: ablation,
            BENCHMARK_MODE: "buffered",
            BENCHMARK_RATE: "2000",
            BENCHMARK_TOPICS: "mixed",
            BENCHMARK_HOST: "linux",
            BENCHMARK_BATCH: "20",
            BENCHMARK_PROFILE: "0",
            BENCHMARK_CPU_PERIOD: "10000",
            BENCHMARK_REDIS_CPU: "0.25",
            BENCHMARK_SEMI_SPACE: "0"
          }
        }
      );
      let log = "";
      child.stdout.on("data", (data) => {
        log += data;
      });
      child.stderr.on("data", (data) => {
        log += data;
      });
      const exitCode = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
      });
      await fs.writeFile(path.join(output, `${ablation}-${repetition + 1}.log`), log);
      try {
        const file = path.join(root, "logs/verification/phase-5", variant, "result.json");
        const result = JSON.parse(await fs.readFile(file, "utf8"));
        assert.equal(result.cleanupComplete, true);
        assert.equal(result.ablation, ablation);
        runs.push({
          ablation,
          repetition: repetition + 1,
          file,
          exitCode,
          fixturePassed: result.passed,
          checkpointP95Ms: result.busMs["p(95)"],
          checkpointP99Ms: result.busMs["p(99)"],
          operationP95Ms: result.operationMs["p(95)"],
          operationP99Ms: result.operationMs["p(99)"],
          capacityRefused: result.capacityRefused,
          unscheduledEvents: result.unscheduledEvents,
          events: result.events,
          measurementMeaning: result.measurementMeaning
        });
      } catch (error) {
        runs.push({
          ablation,
          repetition: repetition + 1,
          exitCode,
          invalid: true,
          reason: error.message
        });
      }
      console.log(JSON.stringify(runs.at(-1)));
      await fs.writeFile(
        path.join(output, "progress.json"),
        JSON.stringify(summarize(runs), null, 2)
      );
    }
  }
  const groups = summarize(runs);
  const summary = {
    checkedAt: new Date().toISOString(),
    diagnosticOnly: true,
    scope:
      "Three 60s runs per mode, interleaved with fresh full baselines; same 2k/s mixed HTTP feeder, batching and combined Docker quotas. Not real WebSocket traffic or a dedicated host.",
    caution:
      "Stub and normalization checkpoints are NOT Redis publication latency or durability acceptance. Normalize-only also removes codec/batching. Inactive services retain quotas; no CPU reallocation. Differences suggest dependencies, not a unique causal bottleneck.",
    groups
  };
  const file = path.join(output, "summary.json");
  await fs.writeFile(file, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ file, ...summary }));
  if (!Object.values(groups).every((group) => group.allFixtureChecksPass)) process.exitCode = 1;
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { summarize };
