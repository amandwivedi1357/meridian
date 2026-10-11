# Local Ingestion Benchmark

## Ablation Method (2026-10-11)

### Investigation Paused: Controlled Verification Plan

At the user's request, stop further laptop tuning/ablation. Status: **unresolved**.
Same nominal settings produce substantially different sessions: historical repeat
p95 18.34/22.32/25.11ms versus fresh ablation full baselines 29.24/2.81/2.80ms.
Host/session conditions are uncontrolled, so do not use cross-session differences
to infer a code improvement or attribute a unique bottleneck. Cold-start/cache/CPU
frequency effects are hypotheses, not demonstrated causes. Keep every historical
run, including failures, intact. Ranges are primary; n=3 medians are descriptive,
not evidence of statistically reliable tail performance.

One future verification campaign, not a new laptop run:

1. Use a quiet Linux VM with 2 vCPU and 2GiB RAM. Record CPU model, OS/kernel,
   Docker/runtime versions, commit and working-tree diff, resource limits, Redis
   AOF/fsync, DB configuration and storage. No trading or production credentials.
2. Preserve the full production pipeline. Use a controlled local WebSocket producer
   with deterministic 80/10/10 mixed input at 2,000 events/s through the actual
   connection manager. Capture socket callback receipt before parsing separately
   from the existing post-parse handler boundary, and Redis acknowledgement per
   event. Exchange-network latency is excluded; real upstream traffic is not a
   controllable 2k/s workload. Record both boundaries, never relabel one as another.
3. Predeclare one 60s warm-up, excluded from aggregate measured statistics but
   retained as a labeled artifact with failures/counts. Warm the SAME runtime and
   storage used by the measured campaign, then capture counter offsets at phase
   boundaries. Warm-up failure aborts verification rather than being silently ignored.
4. Run five measured 60s windows with identical settings and no concurrent tuning.
   Report each run's p95/p99, min-max range, accepted/refused/unscheduled counts,
   Redis entries-added and persisted trade/candle deltas, queue/RSS, all-service
   CPU/throttling, Node GC/event-loop and storage IO. Retain failures; no cherry-picking.
5. Assess the original TRD <10ms and zero-loss offered-load gates against ALL five
   runs. No replacement 2k threshold. This is a short controlled check, not a soak.
   If repeatable full-pipeline failure persists, consider a separately approved,
   same-host ablation campaign with seeded randomized variant order and warm-up;
   no automatic extra runs or production refactor.

A separate-writer ADR is deferred until controlled-host full failures recur and
DB-off is clearly better within the same campaign. Even then require explicit
retention/lag, replay/idempotency, crash and overload design; it is not automatically
the correct fix. Return to remaining Phase 5 operational/executor/risk work now.

### Completed Results

All 12 diagnostic runs completed with verified store/stub counts and cleanup.
Values below are medians and ranges of three per-run percentiles, not pooled samples.

| Mode           | Checkpoint p95 median (range), ms | Checkpoint p99 median (range), ms | Operation p95 median (range), ms | Capacity refusals |
| -------------- | --------------------------------- | --------------------------------- | -------------------------------- | ----------------- |
| Full pipeline  | 2.81 (2.80-29.24)                 | 9.23 (7.67-140.04)                | 12.23 (11.78-195.99)             | 480 / 0 / 0       |
| Null DB writer | 2.80 (2.79-2.86)                  | 6.15 (5.97-6.68)                  | 4.12 (4.11-4.25)                 | 0 / 0 / 0         |
| Redis stub     | 1.12 (1.07-1.20)                  | 1.90 (1.74-2.06)                  | 9.78 (9.20-13.60)                | 0 / 0 / 0         |
| Normalize only | 0.300 (0.294-0.304)               | 0.484 (0.471-0.517)               | 0.533 (0.513-0.545)              | 0 / 0 / 0         |

Only full/null-DB checkpoint columns measure real Redis acknowledgement. Redis-stub
columns include normalization/encoding through an in-memory stub; normalize-only
columns exclude encoding/batching/storage entirely. Operation is completion of the
work enabled in that mode, not universally durable DB acknowledgement.
Operation p99 medians/ranges: full 40.94 (40.71-422.89), null DB 8.82 (8.32-10.07),
Redis stub 33.84 (30.65-42.55), normalize-only 0.825 (0.774-0.928) ms.

Every run has zero unscheduled events. First full run accepts 119,520 and explicitly
refuses 480; subsequent full runs each accept 120,020 with no refusals. Two of three
fresh full runs meet the original local <10ms/no-refusal checks, but the cohort is
NOT a repeatable pass. The first full result remains `passed:false` (k6 exit99).
Ablation coordinator exits1 because that failure is retained. Historical cohorts
and their original failures remain unchanged; none proves a dedicated-host gate.

Interpretation: normalization alone is inexpensive; isolated enabled-store modes
are consistent. Removing DB greatly improves the _slow first full baseline_, but
the two later unchanged full baselines have nearly the same publish p95 as null DB.
Therefore these results do NOT conclusively identify DB contention as the root
cause or prove that a separate writer fixes it. Full ingestor throttled time delta
is about 13.97s in run1 versus 3.02s in run2; backlog peaks 993 versus 182. This is
correlation with full-path/shared-host pressure, not proof of which scheduling,
GC, storage or startup condition caused it. Warm-host/order effects remain possible;
the rotating order is not randomized and this is one shared-host session.

Next investigation should control host cold/warm conditions and capture all-service
CPU/throttling/GC/IO while measuring the actual WebSocket ingress boundary. No further
random tuning or production writer refactor is justified by this dataset alone.
Evidence: `logs/verification/phase-5/ablation-2553c27b-942d-4d12-acf4-f90f1df087fe/summary.json`
plus all twelve referenced result/stats/k6 reports. All owned fixtures cleaned up;
no live-feed restart, trading activation or shared data/control changes.

The earlier unapproved 2k/s <20ms proposal is withdrawn at the user's request.
The original TRD target remains unchanged. Keep the historical 18.34-25.11ms
shared-host range as measurements, not a new acceptance threshold.

`scripts/verify-ingest-ablation.cjs` compares fresh full-pipeline baselines against
null DB writes, stub Redis publications, and normalization-only, three 60s runs
per mode. Order rotates by repetition. All retain the same mixed 2k/s HTTP feeder,
20 events/request and Docker quotas; inactive services keep their resource limits.
Real enabled stores must match accepted counts; disabled stores must stay empty.
Failed runs are retained. Report median/range of run p95/p99 and refusals, not just
the best sample. Stub checkpoints are not Redis latency; normalization-only also
removes encoding/batching. HTTP generation/instrumentation overhead remains.

TRD section 4.4 currently specifies Redis publication and Timescale batching inside
the ingestor, with disk-backed retry shedding when DB is slow. It does not prescribe
a separate consumer-group market-data writer. That architecture is a possible
follow-up, not an already-approved requirement. Any such change needs retention
safety, crash/replay/idempotency and consumer-lag checks; XACK alone does not protect
unconsumed entries from stream trimming. No production pipeline change is made by
the diagnostic modes.

## Repeatability And Depth Safety (2026-10-11)

Three identical sequential Linux 60s mixed 2k offered runs use the same 20-event
feeder, profiler disabled, 128-row/1ms buffer, 10ms quota period and combined
2CPU/2GiB service limits. All trials are included, not only the best or passing ones.
These remain shared Docker Desktop measurements, not a dedicated target host.

| Trial | Completed | Refused | Unscheduled | Bus p95 | Bus p99  | DB-inclusive p95 | DB-inclusive p99 |
| ----- | --------- | ------- | ----------- | ------- | -------- | ---------------- | ---------------- |
| 1     | 120,020   | 0       | 0           | 25.11ms | 78.58ms  | 134.95ms         | 234.69ms         |
| 2     | 120,000   | 0       | 0           | 22.32ms | 101.78ms | 142.87ms         | 300.31ms         |
| 3     | 119,860   | 160     | 0           | 18.34ms | 77.35ms  | 93.68ms          | 201.86ms         |

Per-run bus p95 median **22.32ms**, range **18.34-25.11ms**; per-run p99 median
**78.58ms**, range **77.35-101.78ms**. These are medians of run percentiles, not
pooled event percentiles. Reported k6 completed-event rate median 1,998.66/s,
range 1,997.22-1,999.32/s, including drain. Two trials have no capacity refusals;
the third fails k6 checks/thresholds (k6 exit99, coordinator exit1), with 160 explicit
refusals. Every accepted Redis/DB count matches and all fixtures cleanly shut down
and clean up. No offered-load guarantee follows: the original <10ms gate fails
all three; the proposed <20ms/no-refusal combined gate also passes none of the three.

Evidence: `logs/verification/phase-5/repeat-ef5bb232-7f7f-400c-b09d-f616439c971f/summary.json`
and its three referenced per-run reports. `scripts/verify-ingest-repeats.cjs`
automatically retains failed trials and writes percentile medians/ranges; it exits
nonzero when original local gates fail. Run with `BENCHMARK_REPEATS=3` (or 4/5).

A separate **single** Windows normal-load run, 250/s mixed synthetic BTCUSDT,
one event per HTTP request, 60s, completes all 15,000 events with zero refusals
or unscheduled work. Bus p95 **6.62ms**, p99 **8.96ms**; durable p95 26.25ms,
p99 30.86ms, RSS 113.83MiB, backlog16. Accepted Redis counts exactly match
12,000 trades/1,500 depth/1,500 candles, and durable trade/candle counts match.
Clean exit/cleanup pass. Evidence: `windows-normal-250-mixed/result.json`.
This is direct normal-load fixture evidence, not an inference from the earlier
four closed-loop trade VUs, three-symbol coverage or live WebSocket load acceptance.
Do not treat an assumed 250/s normal rate as a promise about actual market traffic.

Depth overflow safety now has a controlled-transport regression using the actual
connection manager and production buffered normalizer/protobuf publisher. Deferred
Redis responses fill the 1,000-event queue; depth diff1001 is refused, socket closes,
readiness becomes false, late depth/open callbacks cannot restart ingestion, every
accepted diff drains before storage/lease release, and a fresh supervisor attempt
accepts diff1002. Rejection counter stays cumulative. This proves the production
message-handler/fencing boundary with fake socket/storage IO; it is not a real
exchange/TCP saturation experiment or a timed supervisor-daemon restart test.

The test exposed a late-open timer leak: an old closed socket could restart stale
and rotation timers. Connection-manager open handling now requires reconnect to be
enabled and the socket to be current/rotating; a separate regression fences it.
Real test-owned Redis/API gap detection rejects1000->1002 across batches; SSE resync,
snapshot bridging, and browser gap recovery/atomic book clearing regressions pass.
The dashboard cannot apply the missing depth chain as a synchronized book; it needs
a fresh snapshot. No full deployed trading-strategy/exchange safety gate is inferred.

The user chose to keep workload-specific targets a **proposal** in TRD section10.
Active targets and old pass/fail evidence are unchanged. HTTP bus timing excludes
request transit/response delivery; handling still competes for CPU. WebSocket
measurement starts after JSON parsing. Comparisons must name their receipt boundary.

## Mixed Load And Burst Follow-Up (2026-10-11)

The public-feed buffer now uses 128-row/1ms batches (capacity remains 1,000).
Trade and candle queries within a batch run concurrently; both settle before the
batch can acknowledge success or report failure. Separate batches remain ordered,
including updates to the same candle. Recorder/legacy paths remain serial.

With the original CPU split and a 10ms quota period, the first unprofiled Linux
2k mixed run completed all 120,020 offered events in the 60s schedule without
refusals or unscheduled iterations. k6's completed-event rate, including its drain
duration, was 1,998.84/s. Receipt-to-bus p95 **17.61ms**, p99 **77.30ms**, DB-inclusive p95 116.92ms,
peak RSS 114.40MiB and backlog 872. Trade/candle counts match; all histories remain
bounded, clean shutdown/cleanup pass. Evidence: `linux-2k-parallel-10ms/result.json`.
This establishes one local no-drop offered-load run, not repeatable <10ms latency
or dedicated-host acceptance. CPU throttle stats were unavailable in this first
run; subsequent fixtures support both cgroup v1 and v2 layouts.

The **20k/s mixed burst for 60 seconds passes the local bounded-overload check**:
1,200,000 offered events, zero unscheduled iterations, 307,400 accepted and 892,600
explicitly refused at the fixture's bounded ingress queue. Realized accepted rate
5,110.13/s, not 20k/s processing capacity. Maximum backlog 1,000, RSS 120.68MiB,
heap 40.94MiB; no OOM, failure or unbounded retained stream. Redis XINFO entries-added
matches every accepted event: 245,920 trades, 30,740 depth and 30,740 candles.
Trade/candle DB counts also match exactly. Clean exit and ownership-checked cleanup
pass. Latencies under overload are bus p95 88.60ms, p99 142.86ms and durable p95 378.79ms, not the
normal-load <10ms claim. Evidence: `linux-20k-burst-grouped/result.json`.

Burst feeder batches contain 200 events per HTTP request (100 requests/s); timings
still include every individual event from packet receipt. Expected 503 capacity
responses are counted in `ingest_capacity_refused`; any other error fails checks.
This tests publication/storage integrity with production ingestion components, not
consumer recovery after retention, recorder IO, WebSocket/network or exchange paths.
Combined service limits stay at 2 CPU/2GiB; they are not a dedicated VM measurement.

Negative experiments are retained, not promoted to runtime defaults. Moving Redis
CPU from 0.25 to 0.5 leaves Node at 1 CPU, worsens p95 to 52.75ms and refuses offered
events (`linux-2k-redis-half/result.json`). A 32MiB V8 semi-space raises RSS to
161.73MiB without meeting the target: p95 21.97ms, 1,140 capacity refusals
(`linux-2k-gc-budget/result.json`). Node cgroup throttling is measured, but is not
proof that all tail latency is caused by Redis or GC. An alternate 0.125-CPU Redis
probe and the original 20-event burst probe are diagnostic only: their harness
integrity assertions failed before a result could be accepted. The Redis 6 client
uses the literal `entries-added` field, now corrected and verified in the burst run.

The <10ms loaded receipt-to-bus gate, repeatable sustained-load acceptance on the
specified host, bus-to-strategy <20ms, internal submission <100ms, deployed exchange
chaos and long runs remain open. Do not mark all performance or Phase 5 complete.

The actual Windows runtime's final unprofiled 2k mixed run also completes all
120,020 events, zero refusals/dropped iterations, exact Redis entries-added and
DB counts (96,016 trades / 12,002 candles / 12,002 depth). k6 including drain:
1,999.74/s; receipt-to-bus p95 **12.45ms**, p99 **17.21ms** (p95 fails <10ms), durable p95 35.92ms,
RSS 213.27MiB, backlog 256, clean exit/cleanup. The Redis-command stage's sampled
p95 9.96ms must not replace the full receipt-to-bus measurement. Windows Node and
storage are not capped to the target host envelope. Evidence:
`windows-2k-mixed-final/result.json`. Normal-load failures under alternate Linux
tuning are retained; the initial no-refusal run is not robust target-host proof.

## Profiling And Bounded Pipelining (2026-10-11)

The initial public-feed implementation overlaps Redis publication with bounded durable
DB batches: capacity 1,000 events, batch size 64, flush timer 5ms, one DB batch in
flight. Each event promise still waits for persistence. Redis commands retain input
order; DB batches execute sequentially. Duplicate candle keys coalesce to the latest
observation within a batch, with closed candles preferred over open updates. Counts
are attributed per event, not multiplied by batch size. A storage/publication failure
latches the buffer, rejects affected work and stops the feed for supervisor recovery.
Capacity overflow is explicit, counted and stops the feed; it is not silent loss.
Shutdown drains accepted work before storage closes. Recorder/legacy CLI ingestion
remains on its original serial path; buffered recording is explicitly unsupported.

| Profiled Windows workload | Events/s | Bus p95 | Durable-operation p95 | RSS peak  |
| ------------------------- | -------- | ------- | --------------------- | --------- |
| Serial, 4 VUs             | 133.94   | 46.75ms | 55.09ms               | 104.20MiB |
| Buffered, 4 VUs           | 256.41   | 5.59ms  | 21.30ms               | 120.45MiB |
| Buffered, 64 VUs          | 3043.67  | 13.07ms | 33.82ms               | 249.47MiB |

These are 60-second synthetic-trade tests using real Redis AOF and Timescale upserts,
the production factory/publisher/writer, and a V8 CPU profiler. Completed/durable
counts are respectively 8,039, 15,388 and 182,673; errors zero, max in-flight 4/4/64.
They are not saturation ceilings or a dedicated 2-vCPU/2-GB host result. The four-VU
latency target passes locally, but the 64-VU <10ms target does not.

Serial stage p95: queue 41.66ms, Redis 5.13ms, DB 8.78ms. After buffering, four-VU
queue p95 is 0.029ms and Redis 5.26ms; DB batch p95 is 10.07ms. Stage quantiles
cannot be added to calculate end-to-end p95; DB batch timing is not per-row latency.
Stage samples retain at most the first 100,000 observations per stage, while k6
end-to-end trends include all successful requests. Process samples are every 100ms.
CPU profiles include fixture HTTP/profiling overhead and idle time, not just business
logic. Windows 64-VU self-time is dominated by native socket writev (~9.44s), with
protobuf byte encoding, exception construction and GC visible; this motivates a
Linux-to-Linux storage-path comparison, not an unmeasured codec rewrite.

A preliminary Windows 2,000/s mixed offered-load probe completed 115,864 events
(80% trades / 10% depth / 10% closed candles), with matching trade/candle DB counts,
~1,931/s and bus p95 26.33ms. k6 could not schedule 4,136 iterations: **target not
passed**, even though no accepted events failed. This is load-generator scheduling
loss, not evidence of Redis message loss. Its kline retention read used the wrong
stream-key order; the harness now uses the shared stream-key helpers and requires
nonempty retained history for every mixed topic. That first probe is not full
mixed-topic retention acceptance.

Evidence under ignored `logs/verification/phase-5/profile-serial/`,
`profile-buffered/`, `profile-buffered-64/` and `profile-buffered-2k-mixed/` includes
`result.json`, `k6-summary.json`, `k6.log` and `ingestor.cpuprofile` (open in browser
DevTools Performance). Success is written only after count checks, clean drain and
ownership-checked fixture cleanup. `passed` means fixture integrity, **not** all TRD
targets; newer reports contain explicit `targetChecks` and dropped iterations.

Repeat the four-VU comparison with `BENCHMARK_MODE=serial` or `buffered`, unique
`BENCHMARK_VARIANT`, and `node scripts/verify-ingest-benchmark.cjs`. Set
`BENCHMARK_VUS=64` for the larger closed-loop trade run, or `BENCHMARK_RATE=2000`
and `BENCHMARK_TOPICS=mixed` for constant-arrival traffic. `BENCHMARK_HOST=linux`
places ingestor/Redis/Timescale together on a disposable private Docker bridge,
with only fixture HTTP exposed to loopback. Combined CPU quotas are 2 and memory
limits 2GiB (ingestor 1.25 CPU/1408MiB, DB 0.5 CPU/512MiB, Redis 0.25 CPU/128MiB,
swap disabled). k6/OS/shared Docker host are excluded; this is not a dedicated VM.
No project secrets, exchange client or shared storage is used.

The completed Linux one-event-per-HTTP mixed probe reaches 1,811.06/s, bus p95
29.77ms, DB-inclusive p95 163.96ms, 108,734 successful events and 11,265 unscheduled
k6 iterations. All 86,988 trades and 10,873 candles persist; each topic retains
nonempty <=2,100 history entries. RSS peak 120.33MiB, no OOM, exit zero and cleanup
complete. Evidence: `profile-linux-2k-mixed/`. **Targets still fail.** Merely moving
storage traffic into Linux does not remove CPU/transport overhead under these quotas.

`BENCHMARK_BATCH=20` sends 20 synthetic events per HTTP request to distinguish feeder
transport overhead from ingestion capacity. Constant-arrival iteration rate becomes
events/sec divided by 20. Every event's latency is measured from the packet receipt
(including generation/normalization) and added to k6 individually, not averaged by
batch. Dropped iterations are multiplied by 20 to report unscheduled events. This is
a different feeder method, not a faster result for the original per-event HTTP test.

Final grouped, profiler-off Linux result: **failed** k6 thresholds (exit 99),
118,140 completed events / 1,968.20 per second, bus p95 17.66ms and durable-operation
p95 194.43ms. Three unscheduled iterations mean 60 unscheduled events; HTTP capacity
refusals also occur, so this does not establish zero-loss offered-load acceptance.
Accepted events all match 94,512 trade rows and 11,814 candle rows; retained history
is nonempty/bounded for all three topics. Maximum backlog 999, sampled RSS 111.66MiB,
heap 37.87MiB, no OOM, clean exit and fixture cleanup complete. Evidence:
`linux-2k-mixed-grouped-unprofiled/result.json` (`passed:false`), `fixture-stats.json`
and k6 artifacts. A previous grouped profiled attempt also failed HTTP thresholds;
its k6 log is diagnostic only. Removing profiler overhead is not enough to meet the
full mixed-load latency/capacity target under this resource split. Tail latency,
mixed DB batching and CPU throttling require further work on a representative host.

These historical results predate the local burst follow-up above. Dedicated-host
sizing, bus-to-strategy, submission and long-soak gates remain open.

## Historical Unprofiled Baseline

Verified 2026-10-11 before pipelining.

| Measurement                                 | Observed                            |
| ------------------------------------------- | ----------------------------------- |
| Duration / load                             | 60 seconds, four closed-loop k6 VUs |
| Successfully published and persisted trades | 9,909                               |
| Throughput                                  | 165.07 events/second                |
| Local receipt to Redis publication p95      | 42.45 ms                            |
| Receipt through durable DB write p95        | 50.19 ms                            |
| HTTP request p95                            | 51.18 ms                            |
| Sampled ingestor RSS / heap peak            | 97.77 / 31.51 MiB                   |
| Maximum queued/in-flight events             | 4                                   |
| Retained Redis entries / durable DB rows    | 2,010 / 9,909                       |
| Failed requests/events                      | 0                                   |

Method: Windows Node + Docker Desktop; production event normalization, Decimal/protobuf
encoding, Redis publisher and Timescale writer, serial queued ingestion, Redis AOF,
per-event durable trade upserts and approximate stream MAXLEN 2000. Synthetic BTCUSDT
trades only; no exchange, recorder, engine, executor or browser. HTTP receipt is the
local timing origin and includes queue wait; bus timing excludes the subsequent DB write.
Fixture PostgreSQL shared_buffers=64MB overrides image autotuning; this is not the
TRD's controlled 2-vCPU/2-GB host. Four closed-loop VUs do not establish a saturation ceiling.

Memory/CPU/event-loop samples are taken every 100ms for the ingestor fixture only;
short peaks can be missed. Container resource snapshots are captured after load, not
peak storage measurements. All completed counts match actual persisted DB rows;
retained protobuf payload decodes successfully. Fixture shutdown exits zero.
Ownership-checked disposable container/volume cleanup completes before success is saved.
Evidence: ignored `logs/verification/phase-5/ingest-benchmark/result.json`,
`k6-summary.json` and `k6.log`. Failed harness attempts are not acceptance evidence.

**TRD comparison:** 42.45ms does not meet the <10ms receipt-to-bus target.
The measured 165 events/s does not demonstrate >=2,000 events/s; a 2k offered-load
or saturation test has not been run. Mixed depth/kline, 20k burst, bus-to-strategy,
order submission and long-run resource stability remain unaccepted. Existing separate
500-SSE acceptance is documented in README, not inferred from this benchmark.
Batching/persistence scheduling should be investigated before claiming production capacity;
this task deliberately records the current implementation without changing its durability.
