/* global __dirname */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

function distribution(values) {
  assert.ok(values.length > 0 && values.every(Number.isFinite));
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    min: sorted[0],
    max: sorted.at(-1)
  };
}

async function main() {
  const repetitions = Number(process.env.BENCHMARK_REPEATS || "3");
  assert.ok(Number.isSafeInteger(repetitions) && repetitions >= 3 && repetitions <= 5);
  const id = randomUUID();
  const output = path.join(root, "logs/verification/phase-5", `repeat-${id}`);
  await fs.mkdir(output, { recursive: true });
  const runs = [];
  for (let index = 1; index <= repetitions; index++) {
    const variant = `repeat-linux-2k-${id}-${index}`;
    console.log(`Starting identical Linux mixed-load run ${index}/${repetitions}`);
    const child = spawn(
      process.execPath,
      [path.join(root, "scripts/verify-ingest-benchmark.cjs")],
      {
        cwd: root,
        windowsHide: true,
        env: {
          ...process.env,
          BENCHMARK_VARIANT: variant,
          BENCHMARK_MODE: "buffered",
          BENCHMARK_RATE: "2000",
          BENCHMARK_TOPICS: "mixed",
          BENCHMARK_HOST: "linux",
          BENCHMARK_BATCH: "20",
          BENCHMARK_PROFILE: "0",
          BENCHMARK_CPU_PERIOD: "10000",
          BENCHMARK_REDIS_CPU: "0.25",
          BENCHMARK_SEMI_SPACE: "0"
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let log = "";
    child.stdout.on("data", (data) => {
      log += data;
    });
    child.stderr.on("data", (data) => {
      log += data;
    });
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    await fs.writeFile(path.join(output, `run-${index}.log`), log);
    try {
      const file = path.join(root, "logs/verification/phase-5", variant, "result.json");
      const result = JSON.parse(await fs.readFile(file, "utf8"));
      assert.equal(result.cleanupComplete, true);
      const run = {
        variant,
        file,
        exitCode: code,
        fixturePassed: result.passed,
        events: result.events,
        eventsPerSecond: result.eventsPerSecond,
        busP95Ms: result.busMs["p(95)"],
        busP99Ms: result.busMs["p(99)"],
        operationP95Ms: result.operationMs["p(95)"],
        operationP99Ms: result.operationMs["p(99)"],
        capacityRefused: result.capacityRefused,
        unscheduledEvents: result.unscheduledEvents,
        targetChecks: result.targetChecks
      };
      runs.push(run);
      console.log(JSON.stringify(run));
    } catch (error) {
      runs.push({ variant, exitCode: code, invalid: true, reason: error.message });
      console.log(`Run ${index} has no accepted integrity report; diagnostic log retained`);
    }
  }
  const measured = runs.filter((run) => !run.invalid);
  const summary = {
    checkedAt: new Date().toISOString(),
    scope:
      "3-5 independent sequential 60s Linux mixed 2k offered runs; same grouped feeder and 2CPU/2GiB combined quotas, not a dedicated host",
    aggregation:
      "Median and range of per-run percentiles, not pooled event percentiles. Failing measured runs are included; invalid runs listed separately.",
    repetitions,
    runs,
    allRunsHaveIntegrityReports: measured.length === repetitions,
    allRunsPassOriginalLocalGates:
      measured.length === repetitions &&
      measured.every(
        (run) =>
          run.fixturePassed &&
          run.targetChecks.twoThousandOfferedFor60sWithoutDrops &&
          run.targetChecks.receiptToBusP95Under10Ms
      ),
    statistics: measured.length
      ? Object.fromEntries(
          [
            "eventsPerSecond",
            "busP95Ms",
            "busP99Ms",
            "operationP95Ms",
            "operationP99Ms",
            "capacityRefused",
            "unscheduledEvents"
          ].map((key) => [key, distribution(measured.map((run) => run[key]))])
        )
      : null
  };
  const file = path.join(output, "summary.json");
  await fs.writeFile(file, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ file, ...summary }));
  if (!summary.allRunsPassOriginalLocalGates) process.exitCode = 1;
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { distribution };
