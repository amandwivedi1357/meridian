# Meridian Current State

This file is the quick resume point for the project. Use it with `docs/implementation-plan.md` when continuing work in a new chat.

## Working Agreement

- The user writes code unless they explicitly ask Codex to code.
- Codex can update `docs/implementation-plan.md` as phases and features are completed.
- Codex owns CSS when frontend styling begins.
- Codex should guide implementation with file names, code direction, and explanations; do not implement production code unless the user explicitly says to do it.
- Codex adds or updates tests for new behavior.
- When the user says `done`, Codex verifies by inspecting files and running relevant checks before confirming.
- Do not block on tiny formatting issues unless they affect correctness, type safety, security, runtime behavior, or maintainability.
- Explanations should be learning-first and can be in Hinglish.

## New Chat Handoff

Latest container observability slice (2026-10-11): completed the three requested
items locally—profile-aware Docker-DNS runtime scrapes,missing Web/probe/ledger
failure coverage,and actual Grafana/Telegram verification. New generator:
scripts/containers/observability-config.cjs;respect identical COMPOSE_PROFILES in
generation/Compose. API/Web default;market adds feed,trading adds Engine/Executor;
unselected services omitted,not green. Backtest remains ephemeral with API/DB
dispatcher/job telemetry. Six-panel Containers dashboard brings total34 panels/four
dashboards;two rules bring total16. Web static readiness and ledger validity gauge
implemented;stale/down scrape values are gated from healthy-looking panels.

Actual isolated API/feed/Web image metrics,all rules and dashboard browser queries
pass. Own Redis stop/restore triggers production dependency rule through isolated
Alertmanager to two Telegram API-accepted firing/resolved messages,zero failures.
Not proof of human receipt or live trading/upstream;Engine/Executor not activated.
All fixtures/anonymous volumes/networks/temporary private config cleaned.
Evidence logs/verification/phase-5/meridian-observability-a93195b8b4174de984228dfe10078408/result.json;
screenshots alongside. Earlier two monitoring-port setup failures retained,no sends.
Regression29 health/dispatcher tests pass(two opt-in skips),six profile/routing
tests,three Promtool suites,nine current-image checks(including8 Linux entrypoint
tests) pass. API/Web images rebuilt;shared API/feed/storage/control/host scraper
unchanged. Existing Grafana provider may load new dashboard but container panels
need deliberate container-stack deployment. Usage/scope:docs/containers.md.

Next recommended work:nightly DB backup with actual disposable restore verification;
HTTPS/provider secret-store deployment and CD afterward. Full TRD/every-service/
production-size telemetry,tracing/Sentry,deployed exchange chaos,dedicated-host
performance and previous long-run gates remain pending. No Phase5 completion claim.

Latest Phase5 Docker image checkpoint (2026-10-11): multi-stage, digest-pinned
non-root images implemented for API, Web, Ingestor, Engine, Executor and Backtest
Worker. Production-only workspace packaging, .dockerignore secret-file exclusions,
SSE-aware NGINX static/proxy config and opt-in hardened Compose overlay added.
API_HOST is configurable with IP/port validation; local default stays loopback.
Trading images refuse startup without explicit Testnet confirmation and always
refuse production; entrypoint preserves child failures/signal deaths rather than
reporting false graceful success. Durable kill state is never reset.

Final verification: nine isolated image checkpoints pass,22 API regression tests
and8 Linux entrypoint tests pass; backend images243-282MiB,Web78MiB under the
512MiB packaging sanity ceiling. Actual API/Web health,authenticated proxy and
account SSE,Backtest CLI migration/listing and absent-claim job-child loading,
Ingestor liveness with truthful unavailable-upstream readiness503,and SIGTERM
exit0 verified. Evidence logs/verification/phase-5/meridian-images-0ca10569129f401ba0430ff012b1e886/result.json;
ownership-checked containers/anonymous volumes/network removed. No real keys,
exchange orders,shared data migration,service restart or trading activation.
Affected lint/formatting and whitespace checks pass;user API-main edit preserved.

Docker image plan item complete,not full Phase5. HTTPS/Secure-cookie browser
deployment,provider secret store,CD,backups,tracing/Sentry,full metric coverage,
real deployed/exchange chaos and dedicated-host performance remain separate.
Standalone Backtest Worker remains a CLI,not a fake permanent health daemon;
MCP image is deferred to Phase6. Usage/scope:docs/containers.md.

Latest Phase5 Executor full-runtime safety checkpoint (2026-10-11): added
scripts/verify-executor-chaos.cjs with actual production entrypoint/service loop,
real Redis AOF/Timescale,actual signed REST/user-data WS and risk/storage/recovery.
Build-only adapter uses local fake-credential exchange on internal UUID Docker
network,no published ports/.env/shared data. Eight checks pass:startup,duplicate
signals/fills+older updates,actual SIGKILL after accept/beforeACK without resend,
Redis network blackhole/kill/restart,durable kill+cancel,reconnect and SIGTERM exit0.
Final:two simulated orders/one send each,one fill/one cancellation,zero pending,
zero write-ahead violations/unexpected requests,kill=true;cleanup verified.
Evidence executor-chaos-5d2aa7e4051142d381a77dd1cb0e1fe1/result.json under ignored
logs/verification/phase-5. SIGTERM797ms including Docker overhead.
Real bug found/fixed:stuck Redis XREADGROUP starved safety ticks on network blackhole.
Default Executor Redis commands now have5s deadline/socket destroy on expiry,
unblocking queued work;normal read BLOCK1000ms fits. Does NOT authorize resend.
Production code edited only Executor transport;no shared service restart/trading
activation/kill reset or new performance experiment. Full deployed-image/real
exchange chaos remains open. Method/details:docs/observability.md,scripts/README.md.

Final verification:156 Executor tests across24 passing files,14 opt-in skips;
new deadline suite9 tests includes queued safety-command rejection/late reply/timer
cleanup. Build/typecheck and affected lint pass. All test containers/networks removed.
Read-only shared orders/fills0/0,kill=true;existing public feed ready HTTP200.
No commit or shared process refresh. Unrelated user edits (including API main) preserved.

Performance investigation stopped on this laptop by user instruction (2026-10-11).
Status unresolved; host/session conditions uncontrolled, no cross-session code
causality or guaranteed targets. No further local tuning, ablation, soak or writer
refactor. One future controlled campaign is planned (not launched): quiet Linux
2vCPU/2GiB VM, one explicitly labeled warm-up and five measured runs at actual
WebSocket receipt/publish boundaries, with per-run p95/p99/ranges/accounting and
all-service resource evidence. Details in docs/benchmark.md. Warm-up is retained
but excluded from aggregates; historical first-run failures are NOT discarded.
Separate-writer ADR deferred pending repeatable dedicated-host full failures and
clear within-session DB-off improvement. Production ingest unchanged. Resume Phase5
operational hardening and executor/risk verification; no authorization to activate
trading or mutate shared kill/allocation state is implied.

Return-to-safety verification:80 credential-free tests across8 files pass for
signal execution/write-ahead/recovery,kill switch,risk engine/runtime gate,
UNKNOWN operator resolution,startup reconciliation/runtime factory and shutdown.
No new production edits or exchange calls; this is a focused regression checkpoint,
not full deployed Executor/exchange chaos acceptance. Next scoped Phase5 safety
work is isolated full-runtime chaos coverage; production trading remains off.

Latest ablation checkpoint (2026-10-11): user withdrew the unapproved sustained2k
<20ms proposal; TRD retains original active targets and the unapproved normal250/s
<10ms proposal. Three interleaved 60s mixed2k runs EACH of full/no-db/no-redis/
normalize-only completed. Full real-publish p95 median2.81ms(range2.80-29.24), p99
median9.23ms(7.67-140.04); first full run480 refusals, later two none. Null-DB
real-publish p95 median2.80ms(2.79-2.86), p99 median6.15ms(5.97-6.68); all zero
refusals. Redis-stub/normalize checkpoints are NOT real Redis latency; respective
medians1.12/0.300ms. All12 accepted-event/store/stub checks and cleanups verified,
zero unscheduled; first full fixture failure retained, coordinator exit1 deliberate.
Two later unmodified full runs are fast: DB bottleneck/decoupling fix NOT proven.
Shared-host variability/cold-warm scheduling remains unresolved; strict acceptance
pending. TRD4.4 currently has inline DB batching plus disk retry shedding intent,
NOT a prescribed separate market-data consumer writer. Any future split requires
lag/retention/crash/idempotency safety, not just XACK. No production changes or live
feed restarts. New diagnostic runner and three summary unit tests pass; affected
lint/format pass. Evidence/method/full percentile ranges: docs/benchmark.md and
ablation-2553c27b-942d-4d12-acf4-f90f1df087fe/summary.json under ignored logs.
Earlier checkpoints below are historical and do not override this withdrawal.

Latest repeatability/depth-safety follow-up (2026-10-11): user explicitly keeps
normal250/s <10ms and mixed2k/s <20ms targets as a proposal, not approved replacements.
TRD section10 has a clearly unapproved proposal and exact receipt-boundary notes;
original targets and old pass/fail evidence remain intact. Three sequential identical
Linux 2k mixed runs: bus p95 25.11/22.32/18.34ms, p99 78.58/101.78/77.35ms.
Per-run p95 median22.32ms (range18.34-25.11), p99 median78.58ms (77.35-101.78).
Two accept all offered events; third refuses160 at bounded capacity (k6 exit99).
No unscheduled work; accepted Redis/DB counts and cleanup match every trial. Neither
original <10ms nor proposed <20ms/no-refusal combined gate passes any of the three.
Repeat runner retains all failures, exits1 intentionally and writes summary.json
under repeat-ef5bb232-7f7f-400c-b09d-f616439c971f. No guarantee from a single run.

Separate single Windows normal250/s mixed BTCUSDT HTTP-fixture run accepts all15000,
zero refusals/unscheduled, exact Redis/DB counts, bus p95 6.62ms/p99 8.96ms,
clean shutdown/cleanup. Not three-symbol/live-WebSocket/target-host acceptance.
HTTP bus timer excludes HTTP request transit/response delivery and includes feeder
generation; WebSocket callback starts after JSON parsing. Keep scope explicit.

Depth-overflow regression now exercises the actual production connection manager
and buffered ingestor with controlled fake socket/storage IO: depth1001 refused,
socket closed/readiness false,1000 accepted diffs drained, late messages ignored,
fresh attempt accepts1002. It exposed and fixed a closed-socket late-open timer leak;
open now requires reconnect enabled and current/rotating socket identity. Independent
real test-owned Redis/API1000->1002 gap detection, SSE resync, snapshot bridging and
browser atomic book clearing/fresh-bootstrap regressions pass. Not a real-exchange
TCP overload or timed supervisor-daemon recovery experiment. No trading approval.

Latest verification:1161 service tests across158 passing files (8 opt-in skips),
22 browser library regressions and2 Node repeat-summary tests pass. Binance-client
and ingestor builds, ingestor typecheck and affected lint pass. Full prior gates,
representative-host/actual-WebSocket load, deployed exchange chaos and long runs
remain open. Details and evidence in docs/benchmark.md. Older checkpoints below
are historical. No commit, new soak or Engine/Executor activation.

Final live check after loading the late-open fix: public task ready HTTP200,
trade/depth/kline counters701/81/160, backlog0/rejections0, upstream age102ms.
Shared orders/fills remain0/0 and global kill engaged; benchmark containers and
networks fully removed. Final affected lint/formatting/whitespace checks pass.

Latest performance follow-up (2026-10-11): public buffer now 128 rows/1ms, still
1,000 events and ordered batches. Trade/candle writes within a batch run concurrently
and both settle before acknowledgement/failure; two regressions cover success/drain.
The Windows final 60s mixed 2k offered run accepts all 120,020 events with zero
refusals or unscheduled iterations and exact Redis entries-added/DB counts.
Receipt-to-bus p95 12.45ms, durable p95 35.92ms, RSS 213.27MiB, backlog 256.
This is NOT <10ms acceptance or a dedicated 2-vCPU/2GiB host result. The first Linux
128/1 run also accepts all offered events, p95 17.61ms; alternate CPU/GC tuning
regresses, so those settings are not promoted. See docs/benchmark.md.

Local 20k mixed burst safety now passes: grouped 200-event feeder, 60s, all 1.2M
offered with zero scheduling drops; 307,400 accepted / 892,600 explicitly refused
at the bounded ingress queue, backlog capped 1,000, RSS 120.68MiB, no OOM/failure.
All accepted per-topic Redis entries-added match, as do durable trade/candle rows.
Accepted throughput is 5,110.13/s, NOT 20k/s processing. Clean exit/cleanup complete;
evidence linux-20k-burst-grouped/result.json. Dedicated-host sustained/latency,
bus-to-strategy/submission, deployed exchange chaos and long-run gates remain open.
Failed earlier feeder/XINFO assertions do not count. No trading/commit/soak approval
is inferred from this follow-up. Older checkpoints below are historical.

Final verification for this follow-up: 1,159 tests across 158 passing files, eight
opt-in crash tests skipped (previous separately opted-in run passed all eight).
Ingestor typecheck/build, affected lint, formatting and whitespace checks pass.
Public-only task refreshed to PID11796, private readiness HTTP200, backlog/rejections
zero and processed counters advancing. Task Scheduler requires waiting until the
old instance is Ready before starting; the first immediate stop/start raced and was
corrected without deleting the ownership lease. Shared orders/fills0/0, kill=true;
no benchmark containers/networks remain. No Engine/Executor activation or commit.

Profiling/pipelining follow-up (2026-10-11): user authorized Codex implementation and performance profiling. Measured serial queue wait p95 41.66ms, Redis 5.13ms, DB 8.78ms; implemented opt-in bounded public-only ingestion (1000 events, 64-row/5ms DB batches, one DB batch in flight, overlapped Redis publication), per-event durable acknowledgement, latest/closed-candle coalescing, failure latch, accepted-work drain and explicit backpressure rejection counter. Serial recorder/legacy modes are unchanged. Profiled four-VU trade baseline -> optimized: 133.94 -> 256.41/s, bus p95 46.75 -> 5.59ms. Larger 64-VU trade run: 3043.67/s, 182673 matching rows, zero errors, bus p95 13.07ms (does not pass <10ms at that load).

Full mixed 2k capacity is NOT complete: Windows offered probe ~1931/s; Linux combined service quotas 2 CPU/2GiB probe 1811.06/s, bus p95 29.77ms, unscheduled iterations. Grouped profiler-off Linux probe 1968.20/s, bus p95 17.66ms, capacity refusals and 60 unscheduled events, explicitly passed:false/k6 exit99. Accepted rows match, all three histories bounded/nonempty, max backlog999, sampled RSS111.66MiB, no OOM and clean drain/cleanup. Dedicated host, 20k burst, actual deployed Executor/exchange chaos and long-run gates remain open. Profiling artifacts and exact methods in docs/benchmark.md; failed attempts/probes are not acceptance. No benchmark changes loosen durability/risk or activate trading.

Final affected regressions: 1,157 tests across 158 passing files, eight opt-in skipped in that broad invocation and separately all eight execution-container crash/recovery tests pass. Tests cover production signal-processing children/real storage with simulated exchange, not full deployed service/real exchange acceptance. Ingestor build, Executor typecheck, affected lint pass. Shared orders/fills verified 0/0, global kill engaged. Public-only scheduled feed refreshed to load the optimization; after ownership lease expiry/retry, backlog zero, upstream age 159ms and the new rejection counter zero. API/Engine/Executor are not restarted or activated by this task. No long soak or commit performed.

Final follow-up verification: 1,146 tests across 157 passing files pass (eight opt-in execution-container tests skipped); affected lint and API/Engine/Executor/Ingestor/backtest builds pass. Final seven-group chaos rerun additionally verifies explicit cancellation reasons (including worker_shutdown), cleanup complete and hung fixture exit polling 3,002ms. API PID 32652/public feed PID 18248 are ready; backlog zero and upstream age 86ms at final read. Both new metric series are actually scraped by Prometheus. A live two-minute receipt-to-bus p95 sample reached ~3.87s during this workload period, distinct from the isolated 42.45ms baseline; queue wait is included and this is not production latency acceptance. Shared orders/fills remain zero, global kill engaged and Engine/Executor off. No leftover chaos/benchmark containers; no commit or long-run completion.

Shutdown/ingest metrics/benchmark follow-up (2026-10-11): bounded cancellation now covers standalone backtest CLI, API job child and legacy ingestor. Replay yields to OS signals, cancelled jobs roll back publication and record worker_shutdown, standalone saved results commit atomically, live smoke stops new input and drains accepted writes. API/Engine/Executor guards register before async startup; real isolated Linux API/backtest/ingestor startup/job cancellation and existing seven-group safety chaos pass. Engine/Executor startup cancellation is mocked with zero storage/trading calls, not actual deployed exchange acceptance. Receipt-to-bus histogram includes local queue/normalization/recording but excludes DB; ws_reconnects_total survives supervisor retries, resets on process restart and counts error/close pairs once. Reset-aware alert/rule fixtures pass. Public-only feed task refreshed, actual trade/depth/kline metrics and readiness verified; API refreshed to PID 32652 and readiness healthy. No trading activation or shared storage reset.

Local k6 baseline passes: 60s/four closed-loop VUs, 9,909 synthetic trades with exactly matching durable Timescale rows, 165.07 events/s, bus p95 42.45ms, DB-inclusive p95 50.19ms, sampled ingestor RSS peak 97.77MiB, zero failures, queue max four and retained Redis 2,010. Evidence logs/verification/phase-5/ingest-benchmark/result.json; README/docs/benchmark.md explain scope and unmet targets. Does NOT meet TRD <10ms or demonstrate >=2k throughput/controlled 2-vCPU-2-GB/saturation/mixed-topic/20k burst/long soak. Disposable fixtures clean up before success evidence. Earlier setup/summary-parsing failures do not count. Phase 5 remains incomplete: deployed Executor/exchange chaos, performance targets, tracing/Sentry, containers/HTTPS/secret store/CD/backups and long-run gates remain open.

Final shutdown/chaos verification supersedes the preliminary count/measurement below: 772 regression tests across 130 files pass (eight opt-in skipped), affected lint/formatting and five builds pass. Referenced shutdown timer remains active until successful cleanup, including cleanup failure; focused reference/latch/deadline tests pass. Final six-scenario Docker rerun and ownership-checked cleanup pass; observed forced-exit polling 2,697ms with a 2,000ms fixture deadline. API refreshed to PID 25972 with the final implementation; public feed remains uninterrupted on its previously loaded runtime. No chaos containers or networks remain. Full-service/CLI/deployment and earlier long-run gates remain pending.

Bounded shutdown/isolated chaos checkpoint (2026-10-11): shared signal guard wired into API, continuous dashboard feed, Engine and Executor; default total deadline 15s through drain/cleanup, repeated signals latch once, hung drain exits nonzero. Engine stops new signal publication; Executor blocks new placement before/after asynchronous readiness/kill checks and final risk evaluation. No kill reset/order cancellation is implied by shutdown. `scripts/verify-chaos.cjs` uses a credential-free bundle on a unique internal Docker network (no published ports, no checkout/.env/project volumes) with real disposable Redis/Postgres and production diagnostics/shutdown/order/kill components. Six checks pass: duplicate fill dedup/older state protection, Redis network cut and kill/restart fail-closed, fixture safety-runtime crash preserves durable kill, actual Linux SIGTERM readiness drop/clean zero exit, hung cleanup exits one. Two-second fixture deadline observed via Docker at 3,060ms including command/poll overhead. Ownership-checked cleanup complete before success evidence: `logs/verification/phase-5/chaos/result.json`; earlier harness setup failures in failure.json do not count. Five affected builds/affected lint pass; 771 regression tests across 130 files pass, eight opt-in execution-container tests skipped. Live feed was not interrupted and still uses its previously loaded implementation; new guard takes effect on its next scheduled/manual restart. Full actual-service/startup/legacy ingestion CLI/backtest worker shutdown, deployed executor/exchange chaos and Phase 5 performance/tracing/container/deployment/backup acceptance remain pending. No trading or shared control changes, no completed long-run gate.

Final Telegram/ledger verification supersedes the preliminary checkpoint count/PID below: 681 regression tests across 101 files pass, eight opt-in execution-container tests skipped, plus three Telegram script tests pass. Ledger collection is independent of API readiness; malformed/unsafe counts and late samples are withheld. Final API PID 6436: application readiness/private metrics HTTP 200 and live ledger sample confirmed; Alertmanager readiness/config pass from its final ignored private mount. Public feed PID 18180 remains untouched. No trading activation or earlier long-run acceptance is implied.

Telegram + ledger/signal metrics checkpoint (2026-10-11): user-configured bot token remains private in ignored `.env`; alias MERIDO_BOT_TOKEN is supported. Explicit private /start discovered one destination. Alertmanager v0.28.1 (loopback 9093, persistent dedup volume, opt-in alerts profile) receives Prometheus alerts and sends grouped firing/resolved Telegram messages; two accepted notifications and zero failures verified, evidence `logs/verification/phase-5/telegram.json`. Secret config is only in ignored `infra/alertmanager/.local/`, outside logs. Intentionally stopped Engine/Executor notifications are locally routed without Telegram by default; set TELEGRAM_TRADING_ALERTS=true and regenerate/reload before those services are expected. No inbound trading commands. API sampled durable orders_total is a current-state population gauge, not transition counter; actual committed backtest states are exported. Fill timing quantiles use latest 1,000 persisted executions, exclude negative clock deltas and include partial fills; no fills means absent latency. Engine exports local event-processing-through-successful-publication histogram without identity labels. Grafana now 28 panels (15/10/3); fourteen rules include repeated risk rejection. Both rule fixture suites, authenticated Chrome provisioning/query/screenshots and actual API ledger metrics pass. Broad 677 tests across 101 files pass, eight opt-in container tests skipped; three Telegram unit tests pass. API/Engine builds and affected lint pass. API refreshed as PID 11860; continuous public feed PID 18180 untouched; no trading processes/orders/controls or new shared backtests. Phase 5 remains incomplete: pure ingest-to-bus/durable reconnect telemetry, every-service/full production performance coverage, shutdown/chaos/benchmark, tracing/Sentry, deployment/secret store/backups and earlier long-run gates remain pending.

Final telemetry regression: 626 tests across 86 files pass with isolated real Redis/Postgres enabled; eight opt-in execution-container tests remain skipped. Affected TypeScript/script lint passes. Authenticated Grafana verification confirms all three provisioned dashboards, 24 panel queries and thirteen healthy evaluated rules; missing financial/trading data remains explicitly unavailable.

Phase 5 financial/exchange/worker telemetry checkpoint (2026-10-11): three provisioned Grafana dashboards now have 24 panels (Operations 15, Trading and Risk six, PnL and Drawdown three). Thirteen Prometheus rules include actual Binance 418/429, stale/unavailable dispatcher and fresh validated drawdown against the effective executor limit. API/Executor REST wrappers preserve responses/retries and export bounded status, latency and one-minute IP weight without secret labels. Shared portfolio reads publish persisted-fill PnL; validated Executor risk snapshots publish scoped drawdown/equity/UTC-day PnL without substituting wallet values. Submit operation latency is not fill latency, and child process exit zero is not durable job success. Authenticated read-only worker health reports ready with zero active children. Both alert fixture suites and authenticated Chrome provisioning/panel-query/rule checks pass; evidence is in `logs/verification/phase-5/`. Preliminary regression: 625 passed, eight opt-in container tests skipped, followed by 23 passing worker-integration/public-fetch tests. Affected builds/lint pass. API restarted as PID 19516; public feed PID 18180 remains uninterrupted. No Engine/Executor, orders, controls or new backtests were started. Phase 5 remains incomplete: full TRD/order lifecycle/fill latency, durable worker results, notifications, tracing/Sentry, shutdown/chaos/throughput, containers/backups/deployment and earlier long-run gates remain pending. Latest checkpoint supersedes the older PnL/worker-pending notes below.

Phase 5 dashboards/rules checkpoint (2026-10-11): two provisioned Grafana dashboards (Operations: 12 panels, Trading and Risk: five panels) and ten Prometheus alert rules are implemented. API cached health now exports dependency availability, retained stream lengths/sample time and fixed engine/executor group lag/pending; unknown/absent groups are not represented as zero. All ten alert firing fixtures and stale/lag/kill non-firing boundaries pass `promtool test rules`; live mounted config and ten rules validate. Actual Docker Desktop scrapes reach private loopback API/public feed with no firewall/binding changes; both are up and storage/fresh upstream samples pass. Repeatable authenticated Chrome verification validates provisioning, every panel query, ten evaluated rule health states, browser errors and screenshots under `logs/verification/phase-5/` (`scripts/verify-observability.cjs`). API/health/SSE tests: 24 pass, zero skips with isolated real Redis/DB enabled; API build passes. API now PID 27132, continuous public feed now PID 18180 through the existing scheduled task; only observability containers recreated with their existing volumes. Trading services remain off. PnL/drawdown dashboards, Binance-specific alerts/telemetry, external notification delivery, worker coverage, chaos/benchmark/deployment and long-run gates are still pending; Phase 5 remains incomplete. Dashboard readiness filters failed scrapes and reachability omits retired targets' stale samples.

Phase 5 started (2026-10-11): private diagnostics listeners and startup/draining readiness are wired into API, continuous public feed, Engine and Executor. API HTTP metrics use bounded route templates; feed metrics survive retry registries; Engine/Executor poll operations expose counts/errors/durations. Prometheus targets now use dedicated 9400-9403 ports. Loopback is the safe default; Docker scraping needs explicit private-network/firewall configuration, not automatic all-interface exposure. See `docs/observability.md` for exact scope and pending acceptance. Engine/Executor are not started for verification; no trading authorization or long-run completion is implied. Phase 5 remains incomplete.

Phase 5 verification checkpoint: all five affected package/app builds and affected TypeScript lint pass. Service regression: 287 passed, 15 infrastructure tests skipped; focused diagnostics/HTTP/retry counter tests pass. Live API restarted as PID 30896; `/health/live`, `/health/ready` and private `9400/health/ready` return 200, and actual HTTP/lifecycle metrics are readable on loopback. Continuous public feed PID 2680 was deliberately not interrupted and still runs its previous compiled implementation; its new diagnostics require the next restart. Prometheus reachability and Engine/Executor process-level readiness/shutdown have not been live-accepted.

Final Phase 5 first-slice regression supersedes the preliminary count: 296 tests pass across 68 files, including isolated real Redis health and PostgreSQL risk storage; eight disposable execution-container tests remain opt-in/skipped. Stale-feed readiness and collector retry regressions pass. Mounted Prometheus config passes `promtool check config`; this is syntax validation, not scraper reachability/reload acceptance. Affected formatting/lint/builds and whitespace checks (accounting for Windows CRLF) pass. No trading service or real operator action was started.

Final UI regression update: 191 tests across 35 files now pass with the real isolated Redis/Postgres integration gates enabled (supersedes the 161-pass/30-skipped preliminary run below). The updated mocked backtest browser flow also passes pagination, retry idempotency, failed-history handling and terminal-job polling stop. Seven-page live viewer checks include a successful authenticated HTML report read. No real operator actions or new backtest submission occurred in this UI verification.

Seven-page recovery rerun also passed: the existing isolated API-kill/recreate test now observes account recovery on Risk, renders trades on Market and counts document requests rather than intentional hash-tab navigations. Exact retained-cursor replay, three missed trades, trimmed-history bootstrap, account recovery, no document reload and healthy no-polling pass; 50 controlled renderer samples p50 245ms, p95 248ms, max 249ms, silent-outage detection 47,992ms and recovery after restart initiation 1,482ms. Shared safety state unchanged and fixture subprocesses/schema/keys cleaned up. This supersedes only the renderer/recovery measurement for the new layout, not the previous 500-SSE load evidence or long-run gates.

Seven-page UI update (2026-10-11, before Phase 5 at user's request): icon-only far-left navigation now has Overview, Market, Trading, Risk, Strategies, Backtests and System, with accessible hover/focus names, active states and reloadable hash deep links. One shared live session remains across page changes. Overview summarizes health/account/activity and a mini chart; Market has the full chart (1m/15m/1h), limited depth/spread, trade tape and sampled storage diagnostics. Trading exposes full order identity/lifecycle columns, fills, positions and UNKNOWN/pending confirmation queue, with no order-placement form. Risk/Strategies retain authenticated controls, require a reason and typed STOP/RESUME confirmation, disable viewer/disconnected actions and do not clear kill on resume. Read-only authenticated `/api/system/workspace` exposes bounded audit metadata (no arbitrary detail payload), applied migrations and allowlisted API-host configuration, not proof of executor liveness. Backtests shows saved results first, adds Sortino/profit factor and an escaped, CSP-restricted HTML report endpoint bounded to 10,000 rows per history; launcher is secondary/collapsed. Engine/Executor/worker liveness, detailed strategy execution/input/position/PnL, active allocation equity and effective executor limits/DB retention are not yet reported; do not infer them from control state or API-host config. No dummy financial data, engine/executor start, actual control action, order or new simulation. Chart framing now resets on interval/empty-bootstrap changes; seven-page live browser checks at 1440px/390px and mocked confirmation checks pass with no overflow/errors, and real read-only audit/migration/report responses pass. Isolated authenticated control regression passes (three fixture audits, rollback/expiry/kill preservation, shared state unchanged). Web/API/report tests: 161 passed, 30 infrastructure tests skipped in that run; builds and affected lint pass. Evidence/harness: `apps/web/scripts/verify-workspace.cjs`, `logs/verification/workspace/`. Live API PID 16428, Vite PID 3572; continuous public feed untouched. Phase 5 and earlier long-run gates remain pending. Legacy combined-dashboard `verify-terminal.cjs` is superseded for the seven-page layout by `verify-workspace.cjs`; backtest/control/recovery harness selectors are updated.

Phase 4 local prototype acceptance completed (2026-10-11): k6 v2.3.0 + pinned xk6-sse v0.2.0 held exactly 500 authenticated SSE connections (250 market, 250 account) on one temporary API instance for 60,034ms. Two cohorts of 250 started 61s apart to respect the unchanged 300/min/IP gateway limit; no rate limit or connection cap was relaxed. Real Redis decoding, market/account SSE, isolated migrated account DB, portfolio reader and cached dependency health were used; events/account changes were synthetic, with no exchange/trading runtime. Actual workload: 2,370 trades at target 20/s, depth + 15m candle + account changes once/second. All 500 ready/completion responses passed, 1,500/1,500 checks, zero errors/resyncs, 510,874 delivered updates and 3,000 heartbeats; all 500 accepted sockets closed and no replacement opens occurred. Event-to-k6 receipt across ramp/steady: p95 266ms, max 317ms; peak API RSS 132.18MiB, heap 56.05MiB. Not browser paint, 500 two-stream browser sessions, Internet performance or long-run production acceptance. The load test exposed a real cold Redis startup race: concurrent opens returned 503 while the first connection was establishing. `createStreamSource.ready` now shares/awaits one initial connect promise; a real isolated 500-opens regression failed before and passes after. Fixture-only instrumentation/import guard was also corrected; only the final single-instance result counts as acceptance. Broad 1134 tests across 132 files pass, API build/affected lint and actual live desktop/mobile charts/trade/SSE/no-polling checks pass. Live API restarted as PID 27016; Vite PID 3572 and continuous feed PID 2680 remain running. Shared orders/fills/audits/events/control state and Redis kill unchanged; all load-test subprocesses, schema and namespace keys removed. Evidence: `logs/verification/phase-4-2/sse-load.json`, `sse-k6-summary.json`; repeatable harness `scripts/verify-sse-load.cjs` + `scripts/load/sse.js`, setup in `scripts/README.md`. README now includes actual committed desktop/mobile screenshots under `docs/images/`. Phase 4.1/4.2 implementation/local gates and screenshot deliverable are complete; next is Phase 5 observability/hardening. Earlier 24h soak, six-month/three-symbol backfill and 48h trading gates remain pending; no resumed monitoring or unattended trading authorization is inferred.

Post-recovery live dashboard check also passes: actual public trade tape advances, seven initial REST reads only, SSE health continues and desktop/mobile real candle charts render without browser errors. Live API PID 30808, Vite PID 3572 and continuous feed PID 2680 remain running; no recovery fixture subprocess remains.

API restart/render-latency acceptance completed locally (2026-10-11): `apps/web/scripts/verify-recovery.cjs` runs the built production UI against temporary API subprocesses with real gateway/cookie auth, namespaced Redis stream decoding/SSE, and an isolated migrated PostgreSQL account schema. Public market bootstrap and dependency health are explicitly synthetic; no exchange/trading client starts. Two abrupt API process deaths/recreations on the same port prove automatic recovery without page reload: the first resumes the exact last applied market cursor without rebootstrap, replays three trades published during downtime and recovers account state; the second deletes test-owned market/account history and proves expired-cursor fresh bootstrap. The test exposed silent half-open SSE responses through the Vite proxy; `live-session.ts` now closes/retries a channel after 45s with no ready/data/health/heartbeat, checked every 5s, preserving existing applied-cursor/backoff/401 handling and clearing watchdogs on shutdown. Healthy heartbeat tests keep channels open without REST polling; silent/never-ready channels and cleanup have two new regressions. 178 API/web tests across 31 files, web typecheck/build and affected lint pass. Fifty controlled event-to-DOM-plus-two-frame observations across desktop/post-restart/mobile: p50 247ms, p95 267ms, max 270ms, all <1s. Silent-outage detection measured 48,154ms; after API restart initiation, recovery/account/trade replay measured 799ms. This is local Redis/API/render latency, excluding exchange/network ingestion, not 500-client latency. Shared orders/fills/audits/events/control state and Redis kill are unchanged; all fixture processes/schema/keys cleaned up. Evidence: `logs/verification/phase-4-2/recovery-latency.json`, `recovery-desktop.png`, `recovery-mobile.png`. The 500-concurrent-client k6 gate remains open; Phase 4.2 is not fully closed. No soak/48h/trading activation.

Final continuous-feed verification: 1130 tests across 131 files pass, including nine dashboard-feed cases. Builds, affected lint and actual read-only Chrome checks pass. Task remains running with advancing trade/depth/kline counts and zero backlog; the earlier 155-test focused checkpoint below was expanded afterward.

Continuous dashboard public feed installed (2026-10-11): normal `apps/ingestor/dist/dashboard-feed.js` has no one-hour stop timer. Current-user Windows task `Meridian Dashboard Public Feed` starts now/at login with limited privileges, no execution-time limit, duplicate-task prevention and crash restart. Node retries dependency/ingestion failures with capped backoff; stale/no-progress sockets restart, Redis ownership renewal prevents duplicate dashboard publishers, ingestion backlog is capped at 1,000, Redis streams at approximately 2,000 entries each, and logs rotate at 5 MiB with one backup. No recorder, engine or executor is started. Explicit `smoke/dashboard-feed.js` retains its one-hour preview cap and now shares the lease. Websocket shutdown during socket-free backoff now cancels reconnect timers. Task verified running as PID 2680; previous preview PID 26752 stopped. Live sample: OPEN, backlog 0, advancing trade/depth/kline counts. 155 ingestor/stream tests across 34 files pass, including fake-clock >1h lifetime, duplicate/lease loss, stale recovery, bounded backlog and backoff cleanup; ingestor/Binance builds and affected lint pass. Real read-only Chrome desktop/mobile terminal verification passes: advancing trade tape, SSE health push, seven bootstrap reads, no healthy polling and no browser errors. API/Vite stay on 3000/5173. Docker must be available and laptop awake; this task does not auto-start API/Vite. PostgreSQL history continues growing on disk; compression/retention remains separate, not silently deleted. Setup/status/stop/remove commands are in `scripts/README.md`. No trading, control mutation, soak resume or 48h gate completion.

Authenticated control E2E completed (2026-10-11): `apps/web/scripts/verify-controls.cjs` verifies the real application in Chrome through temporary API/Vite servers, random viewer/operator JWT-cookie credentials, an isolated migrated DB schema and namespaced Redis. Pause/resume, cancellation of pause/resume/emergency dialogs, Viewer write denial, emergency confirmation, durable actor/reason audit plus risk events, audit-failure rollback, expired-cookie POST 401 and frontend expiry timer pass. No browser credential storage. Actual account REST/SSE are used; market bootstrap is explicitly synthetic and no exchange client/trading runtime is started. Shared orders/fills, audits/events/control state and Redis kill flag are snapshotted before/after and unchanged. Three successful fixture actions yield exactly three audits/events; fixture servers, schema and Redis keys are removed. Evidence: `logs/verification/phase-4-2/controls-isolated.json`, `controls-isolated.png`. The browser test found and fixed a real timestamp issue: account SSE now carries the account transaction's `checkedAt`, separately from cached portfolio time. Sampling timestamps stay excluded from fingerprinting; unchanged snapshots remain deduplicated. New real Redis regression proves control updates advance account time with a fixed old portfolio timestamp and the frontend monotonic replay guard remains intact. 1037 broad tests across 119 files pass, API build/affected lint pass. Local API restarted as PID 30808 and readiness is healthy; Vite stays on 5173. This is not API-restart browser recovery or 500-client acceptance; those plus explicit <1s perceived-latency proof remain the next Phase 4.2 work. Paused soak/48h gate unchanged.

System health dashboard completed (2026-10-11): `SystemHealthPanel` now sits under strategy controls in the left sidebar; risk/kill controls and order book retain their positions. It shows market data age, market/account SSE receipt age, browser recovery counts, Redis/database availability, health sample age and per-topic Redis consumer groups. Undelivered lag, pending acknowledgements and registered consumer count are separate; missing groups and Redis null/unsupported lag are not zero-filled, and registered consumers do not prove active workers. Stale/malformed samples do not retain healthy dependency labels. Authenticated `/api/system/health` supplies one bootstrap; account SSE pushes bounded, cached/coalesced health every five seconds and both streams expose 15-second heartbeats, without altering market/account resume IDs or adding healthy browser REST polling. Fixed seven BTCUSDT/signal topics only; no Redis key scan. Browser recovery counters reset when the live connection cycle resets (login/timeframe); they are not upstream Binance websocket counters. API restarted as PID 20036; Vite remains on port 5173. Real viewer desktop/mobile browser checks prove SSE health advancement/no REST polling, while mocked faults cover degraded/stale/unknown UI. 1035 broad tests across 118 files plus one isolated real Redis consumer-group integration test pass; API build, web typecheck/build and affected lint pass. Saved backtest read regression also passes without new submission; trading counts remain zero and kill engaged. No engine/executor/order/control/allocation/monitoring actions. Evidence screenshots: `logs/verification/phase-4-2/real-desktop.png`, `real-mobile.png`. Phase 4.2 health checklist is complete; next are authenticated control E2E and explicit API-restart/perceived-latency/500-client acceptance, not full Phase 4 completion. Phase 5 full service metrics/upstream reconnect telemetry remain separate.

Authenticated first local simulation (2026-10-11): viewer/operator dashboard credentials and a non-placeholder JWT secret are configured in ignored `.env`, without exposing values. `scripts/setup-dashboard-auth.cjs` preserves valid credentials and allows both localhost and loopback Vite origins. API restarted as PID 10416; Vite remains on port 5173. Sign in with `.env`'s `API_OPERATOR_TOKEN` for simulation submission or `API_VIEWER_TOKEN` for read-only access; cookies are HttpOnly/SameSite Strict and expire after 15 minutes. Public production BTCUSDT 15m backfill covers all 96 closed candles in [2026-10-09, 2026-10-10) UTC. Real browser operator submission succeeded and saved `job:832ec502-e5d2-441e-8ad4-cf1f60c57d2c`: 96 equity points, zero simulated fills, 10,000 USDT equity and zero strategy return/drawdown (buy-and-hold +0.9731777386%). Zero fills is the actual result, not fabricated demo trades. Desktop/mobile result charts and viewer submission denial verified against the real API; live viewer SSE/chart regression passes without healthy REST polling. Focused auth/backfill/backtest tests: 24 across eight files pass. Evidence: `logs/verification/phase-4-2/backtest-live-report.json` and `backtest-live-*.png`; reusable real-browser verification is `apps/web/scripts/verify-live-backtest.cjs` (read-only by default, explicit `--submit` launches a local simulation). Exact shared DB safety check: orders=0, fills=0, kill engaged=true. No engine/executor, exchange order, allocation activation or monitoring restart. Earlier viewer-only/no-saved-runs checkpoints below are historical. Next: system health panel; broader control E2E and restart/load acceptance remain open. Phase 4.2 is not complete.

Backtest launcher/results checkpoint (2026-10-11): Backtests navigation now opens the actual simulation UI, not the unused mock preview. Operator submission supports current backend EMA/BTCUSDT 15m/1h options and increasing past UTC ranges <=30 days; uncertain retries retain one request ID, duplicate/pending submissions are blocked, active status is checked every two seconds and terminal/error states stop that timer. Saved runs/detail, automatic paged equity, Decimal-safe drawdown with explicit initial/observed baseline and paginated simulated fills are connected. Views cap at 100 saved runs, 10,000 equity points and 5,000 fill rows with explicit history limits. Run/job selection and uncertain retry identity survive navigation in memory (not a full browser reload). No fake result data is used by the application. Real local viewer check shows no saved runs and disabled launch; operator roles/results/job lifecycle were browser-mocked, while isolated backend tests execute actual compiled simulation workers. 1023 regression tests across 116 files, web typecheck/lint/build and existing dashboard browser regression pass. Artifacts: `logs/verification/phase-4-2/backtests-*`. No shared simulation submissions, exchange orders, allocation changes or trading processes started. Next: system health panel, then authenticated control E2E and restart/latency/500-client acceptance. Full 4.2 remains incomplete.

Chart correction and terminal controls (2026-10-11): production API market bootstrap now seeds the chart with 200 recent, contiguous, validated closed Binance candles from the same `MARKET_DATA_ENV` client as depth, then merges live SSE candles. It no longer mixes arbitrary old DB/fixture history into the current chart. Public history is coalesced/cached for 30 seconds per topic, bounded to four topics and refreshed at candle boundaries; failures remain explicit. This is display bootstrap, not a durable DB/backtest backfill. Terminal chart now has sensible recent-range zoom, candle/line styles, volume, crosshair OHLC/time readout, zoom in/out, reset, latest-candle navigation and native fullscreen. Exact decimal strings remain in API/store; only drawing coordinates use numbers. Real Chrome verified all 1m/5m/15m/1h histories, useful canvas candle framing, hover/controls/fullscreen, mobile sizing and SSE updates without healthy REST polling. 1012 regression tests across 114 files, API build, web typecheck/build and affected lint pass. API restarted as PID 29036; public-only preview was restarted as PID 17944 with the same one-hour bound. Trading remains off; no order/control writes were issued against shared state. Phase 4.2 backtests/health/restart/load acceptance remain pending.

Phase 4.2 checkpoint verification: 1006 regression tests across 113 files passed; the final account replay monotonicity guard then passed all 18 frontend tests. Web typecheck, affected lint, production web build, ingestor build and whitespace check passed. Mocked and actual read-only Chrome checks passed on desktop/mobile; authenticated backend role/control tests remain isolated. No full Phase 4.2 exit-criteria claim.

Latest Phase 4.2 dashboard checkpoint (2026-10-10): connected terminal now uses cookie-session login/logout, viewer/operator gating, REST bootstrap followed by market/account SSE into Zustand, applied-cursor reconnect, bounded frame queues, frame-batched updates with hidden-tab fallback, resync on book gaps, expiry cleanup and stale-market labels. Candles/volume, limited depth, trade tape, orders/fills/positions/risk and wallet/ledger values use actual API data; unavailable values remain explicit rather than mocked. Confirmed reason-required pause/resume/global kill controls are wired, with keyboard-contained dialogs; real browser verification remained viewer-only and control POSTs were mocked. A public-only preview feed is running with PID 29136 for at most one hour from startup, approximate Redis MAXLEN 2000 per market stream, backlog cap 1000 and no NDJSON recorder/trading client. It stops automatically; restart with `node --env-file=.env apps/ingestor/dist/smoke/dashboard-feed.js` after building the ingestor. API/Vite remain at 3000/5173. Real Chrome check: trade tape advances, no repeated healthy REST reads, desktop/mobile screenshots and no page errors. Artifacts: `logs/verification/phase-4-2/`. Local API auth credentials remain unconfigured/viewer-only; login roles were browser-mocked, not claimed as a configured real operator session. Remaining 4.2: backtest launcher/results, detailed health metrics, restart/load acceptance and broader control E2E. Historical candles are whatever persisted history is available; no gap filling or fabricated continuity. No engine/executor, allocation activation, orders, 48h run or monitoring restart.

Latest Phase 4.1 backend completion (2026-10-10): every 4.1 implementation checkbox is now verified. Actual read-only Testnet wallet balances and batched same-environment public quotes are integrated into portfolio/positions/summary/account SSE. `equityScope: exchange-wallet` distinguishes full wallet equity from persisted-fill PnL. Free/locked inventory is compared against tracked base quantities; unexplained/opening inventory is explicit with unknown cost basis, not turned into fake PnL. All nonzero holdings stay visible; stale/unpriceable inputs withhold equity. Live wallet check: 517 assets, three unpriceable, correctly null full equity, unattributed opening inventory and successful account SSE. Real bounded public BTCUSDT ingest passed synchronized REST bootstrap, cursor handoff and Last-Event-ID depth continuity; it stopped after verification. Evidence: `logs/verification/phase-4-1-wallet.json`, `logs/verification/phase-4-1-market-bootstrap.json`. 988 tests across 111 files pass; API/Binance/ingestor builds, affected lint and UI typecheck pass. API and Vite remain running, local auth viewer-only, kill engaged, shared orders/fills zero. No engine/executor, allocation activation or live orders. Next: Phase 4.2 browser auth/SSE/store/real tables and controls. Explicit audited full-wallet opening cost input, historical third-asset fee conversion and scalable fan-out/load proof remain in finishings; 48h Phase 3.5 stays pending and monitoring stays paused.

Final follow-up verification: 989 tests across 111 files pass. Account Redis history now retains exactly at most 128 snapshots, capped at 240 KiB each (30 MiB maximum retained payload plus Redis overhead). Trimmed cursors explicitly require REST resync. The real wallet/account SSE check passes after the final API restart; safety state remains unchanged.

The following entries are historical progress snapshots; the latest completion note above supersedes their pending 4.1 items.

Phase 4.1 backtest jobs update (2026-10-10): durable operator-only audited submission and viewer status implemented at `/api/backtests/jobs`; migration 008 applied locally. Jobs are idempotent per actor/requestId, queued in PostgreSQL, single-concurrency, leased/token-fenced, and executed in bounded simulation-only Node children without trading credentials. Existing EMA/BTCUSDT 15m/1h replay supports past UTC ranges up to 30 days, requires complete aligned stored candles and atomically saves results/success status. Explicit errors cover missing history, timeout, shutdown, lost worker and generic worker failure. Queued work survives restart; failed work is not automatically retried. Verification: 899 tests across 82 files pass, including 22 new job/contract checks; API/DB/worker builds, API lint and UI typecheck pass. Migration command skips already-applied migrations correctly. See `docs/api-gateway.md` for setup/contracts. Shared kill remains engaged, orders/fills remain zero. Phase 4.1 still needs wallet equity/opening inventory and real market bootstrap acceptance; browser auth/SSE/backtest submission integration is Phase 4.2. No unattended or live trading started.

Phase 4.1 contracts/controls update (2026-10-10): gateway now applies runtime JSON response schemas across registered legacy REST routes and publishes rich OpenAPI success/error contracts. Serializer rejects malformed DTOs with sanitized 500 responses; Decimal market values stay strings and saved-run Date values normalize to ISO. Candle input contract rejects unsupported 4h/1d intervals. Strategies read is bounded to 100. Isolated control API integration verifies JWT viewer/operator cookie roles, origin/confirmation checks, pause/resume and kill audit/events, transaction rollback when audit/event insertion fails, global kill preservation across resume and durable kill on Redis propagation failure. 451 tests across 50 files pass, API build/lint and UI typecheck pass. No live/shared controls or exchange orders changed. Phase 4.1 still needs wallet equity/opening-inventory reconciliation, backtest job submission/status and real market bootstrap acceptance; UI SSE is still unwired (4.2).

Phase 4 portfolio update (2026-10-10): fee-aware persisted-fill positions and all-time realized/marked unrealized PnL implemented using a shared core spot-accounting helper also used by Testnet allocation. `/api/account/portfolio` is response-validated; positions/summary and account SSE share the reader. Metadata/marks use trading `BINANCE_ENV`; unknown basis/third-asset historical fees/stale prices stay unavailable/null. Wallet equity remains null pending wallet/opening-inventory integration. Replay is bounded (10,000 fills/five symbols), coalesced and cached for two seconds. 441 regression tests across 48 files pass, including real isolated fills into SSE; public Testnet metadata/depth read-only smoke passes. UI remains unwired; no orders or allocation changes made. Phase 4 remains incomplete.

Phase 4 bootstrap update (2026-10-10): `/api/market/snapshot` captures market Redis checkpoints, bridges public Binance REST depth with retained deltas via the existing depth-sync engine, and returns limited-depth book/candles/trades plus an SSE replay cursor. Missing/stale feeds fail closed with 503. `MARKET_DATA_ENV` defaults to production and must match ingestion; trading `BINANCE_ENV` is separate. SSE accepts a bootstrap query cursor and prefers the reconnect header. API/Binance REST verification: 294 tests across 34 files pass, including isolated infrastructure checks. UI remains polling; live market acceptance, real PnL, response schemas and the rest of Phase 4 remain pending. No ingestor/engine/executor was started.

Suggested first message when resuming in a new chat:

```txt
Read docs/current-state.md and docs/implementation-plan.md. The user accepted a Phase 3.5 prototype checkpoint and explicitly kept the 48h gate pending. Latest verification on 2026-10-10: REST account-trade catch-up is implemented after startup/reconnect reconciliation; missed `/api/v3/myTrades` fills persist idempotently through `order_fills`, duplicate trade IDs are ignored and older REST catch-up cannot move order state backwards. A bounded live Testnet missed-fill fixture passed: two BTCUSDT IOC orders were filled with user-data persistence intentionally skipped, reconciliation found both as terminal-on-exchange, REST account-trade catch-up persisted both fills, and own open orders ended at zero. Artifact: `apps/executor/logs/verification/missfill-739454811c0f4f2fb3c2.json`. Authenticated operator resolution for claim-before-send `UNKNOWN` liveness exists, and allocated Testnet backing rebaseline now has an audited operator command that does not clear ledger/equity state or place orders. Latest allocated live fill evidence remains 2026-10-09: audited opt-in Testnet allocation implemented; a real risk-approved deterministic-strategy 0.0002 BTC BUY/SELL round trip passed through live runner, Redis, risk, write-ahead and user-data persistence. Clean candle replay and bounded live kill-switch cancellation also pass. Shared .env/database/Redis configuration remains unchanged; allocation is not activated for unattended use. Full-wallet mode still blocks unpriceable assets. 48h trading and screen recording remain open. See docs/phase-3-5-verification.md for evidence, docs/risk-engine.md for allocation setup and docs/finishings.md for risks. Do not silently filter assets, relax limits or launch unattended trading. New installs start kill-switch engaged; soak monitoring remains paused. Codex owns tests; implementation ownership follows the working agreement unless I explicitly ask Codex to code.
```

Before continuing feature work, verify the baseline:

```powershell
pnpm --filter @meridian/binance-client typecheck
pnpm --filter @meridian/binance-client test
pnpm --filter @meridian/proto typecheck
pnpm --filter @meridian/proto test
pnpm --filter @meridian/ingestor typecheck
pnpm --filter @meridian/ingestor test
pnpm --filter @meridian/engine typecheck
pnpm --filter @meridian/engine test
```

## Project Goal

Meridian is an event-driven algorithmic trading platform using Binance Spot market data and Testnet execution.

The project should be resume-grade, not a toy app. The core engineering story is reliability: decimal-safe market data, local order book sync, event-driven ingestion, backtesting/live parity, idempotent execution, risk controls, observability, and a polished dashboard.

## Stack

- TypeScript monorepo with `pnpm` workspaces and Turborepo
- React/Vite frontend planned
- Fastify API planned
- Postgres + TimescaleDB planned
- Redis Streams planned
- Kysely + raw SQL planned
- Binance REST/WebSocket client in progress

## Current Phase

Latest Phase 4 progress 2026-10-10: API foundation now includes API-key-to-short-lived JWT sessions (viewer/operator roles, HttpOnly cookie, origin checks and production guards), Redis-backed global/login rate limiting, Zod input/type-provider support with generated `/api/openapi.json`, saved-backtest list/detail and paginated fills/equity reads, and `/api/stream/market` + `/api/stream/account` SSE. SSE supports heartbeats, Redis-backed Last-Event-ID replay after restart, trimmed/gap resync, 4Hz contiguous book coalescing and connection/buffer limits. Account SSE uses bounded consistent DB snapshots, not complete event history or live PnL. API/UI running locally at ports 3000/5173; Vite-proxied REST/account-SSE smoke passes. Local API is viewer-only with credentials absent; kill switch engaged. UI still polls and contains mocks; 4.2 login/SSE-store wiring is not done. Typed legacy response contracts, fee-aware marked positions/book bootstrap, backtest jobs and 500-client load acceptance remain open. No trading/ingestor services started. See `docs/api-gateway.md` before continuing; finish API 4.1 before expanding frontend 4.2.

Latest follow-up 2026-10-10: implemented REST account-trade catch-up after executor downtime. Binance account client reads signed `/api/v3/myTrades`; Testnet trading client exposes it behind the same synchronized signed transport. Executor startup/reconnect reconciliation can call account-trade catch-up for matched/terminal reconciled orders, convert REST trades into exact Decimal-string `recordOrderExecutionUpdate` records, and persist fee-aware fills idempotently. `order_fills` now also dedupes by `(client_order_id, trade_id)`, so REST/user-data duplicate trade identity is safe; older REST catch-up data still goes through the existing monotonic event-time guard and cannot move order state backwards. Follow-up fix: added forward-only migration `006_order_fills_trade_id_dedupe_index` so already-initialized databases receive the trade-id dedupe index instead of relying on edits to historical migration 004. Verification progressed from mocked clients to bounded live Testnet evidence: `missfill-739454811c0f4f2fb3c2` placed two BTCUSDT IOC orders, intentionally skipped user-data persistence, recovered both fills through reconciliation + REST account-trade catch-up, and ended with zero own open orders. Artifact: `apps/executor/logs/verification/missfill-739454811c0f4f2fb3c2.json`.

Latest safety follow-up 2026-10-10: allocated Testnet backing rebaseline is implemented. `risk-control-cli rebaseline --reason <reason> --confirm-testnet-rebaseline` authenticates the operator, performs read-only metadata/balance/open-order preflight, projects the current managed portfolio from persisted fills and managed orders, and writes `testnet-allocation-rebaseline` audit details. It does not place orders, reset the kill switch, clear order/fill history, clear risk equity peaks/losses, or mutate the immutable allocation policy. Added `smoke:catch-up -- --confirm-read-only-account-trades`; it ran successfully against Testnet credentials/shared DB with `checked:0`. The later bounded `verify:missed-fill-catch-up` fixture supplied affected filled orders and proved live catch-up persistence.

Latest ingestor follow-up 2026-10-10: Redis market stream retention is configurable through `INGESTOR_REDIS_STREAM_MAXLEN`. When set, ingestor Redis publishing uses `XADD ... MAXLEN ~ <N>` for market streams, bounding the hot Redis window while Timescale and optional NDJSON remain durable history. Verified with `@meridian/ingestor` typecheck/build/tests passing 75 tests across 27 files.

Latest live follow-up 2026-10-09: implemented optional audited Testnet allocation shared by engine/executor with immutable account/config binding, initial backing baseline, fresh-ledger/engaged-kill initialization, fee-aware positions and wallet/foreign-order drift rejection. Verified real risk-approved BUY/SELL fills through deterministic one-shot strategies on actual closed candles: 0.0002 BTC at 82714.01/82731.6; final allocated equity 100.003518 USDT, zero managed residual BTC and own open orders. Exchange fees were zero; nonzero fee handling has unit coverage. Artifact: `logs/verification/fill-4b0f19c47a01490690ca.json`. Regression: 1,118 tests / 130 files; core/DB/engine/executor builds pass. This completes the bounded-fill prototype check, NOT full Phase 3.5 acceptance. Full-wallet valuation/opening-inventory handling, 48h run and screen recording remain open. Shared application configuration and infrastructure were untouched; no unattended trading started.

Evidence caveat: the first fill fixture passed but used separate strategy IDs and did not check the final daily-PnL monitor. A follow-up with one strategy ID filled both legs and passed that monitor, then failed only its final evidence-export query. Export was fixed using the existing repository join and verified in real PostgreSQL; the final script has not been rerun live. The second artifact remains `failed-cleaned-up`, not a clean pass. All four fill-check orders were independently confirmed FILLED, managed inventory is flat and BTCUSDT open orders are zero. See `docs/phase-3-5-verification.md` for exact provenance.

Earlier checkpoint 2026-10-09: prototype verification completed within the user's revised scope; full Phase 3.5 acceptance is NOT claimed. Clean 101-candle replay matches all 28 recorded live-runner signals under identical simulated accounting. Actual Testnet kill engagement canceled its exact 0.0002 BTC fixture order in 429 ms, persisted NEW/CANCELED user-data state, emitted an alert and blocked the next signal. A real DTO-shape cancellation bug was fixed. The three cancellation-fixture orders closed with zero fills. Read-only recovery checks durable immutable identity before signal expiry/risk approval and preserves uncertain submissions rather than silently ACKing expired ones. Earlier regression: 1,084 tests / 127 files. The subsequent allocation/fill evidence above supersedes the bounded-fill limitation, not the remaining acceptance gates.

Latest verification 2026-10-08: Phase 3.5 is partially verified, NOT complete. Regression passed 1,068 tests / 127 files including actual disposable-container outages and child-process deaths. Real authorized Testnet smoke placed one BTCUSDT 0.0002 LIMIT BUY at 81136.28 and canceled it; own order is not open. Read-only signed/user-data check passed. Recorded-trade-derived parity passed on 14 contiguous 15m bars with three identical signals; recording gaps and lack of recorded klines remain explicit limitations. UNKNOWN claim-before-send recovery is manual/fail-closed through the authenticated operator resolution path. No 48h run or screen recording was performed. Details and repeatable verification commands: `docs/phase-3-5-verification.md`.

Review fixes verified on 2026-10-07: simulator submissions carry explicit client order IDs through pending orders into fills; gateway snapshots update by identity and completed orders remain queryable. Duplicate IDs and untagged/mismatched fills fail closed. Partial fills preserve `PENDING_CANCEL` until the cancellation outcome arrives. Binance order serialization uses fixed-point decimal strings. Write-ahead persistence now checks immutable order details atomically on client-ID conflict and requires the database adapter's `rowCount` result; mismatches throw instead of silently succeeding, while identical retries preserve state/timestamps. PostgreSQL verification used a temporary table and rollback: insert, identical retry, and nine conflicting retries passed. The downstream third-migration expectation and three lint errors are fixed. Affected-package regression baseline: 823 tests across 85 files; build/typecheck and lint pass. No live Testnet orders were placed or canceled for these fixes. Phase 3.2 reconciliation, out-of-order handling, and other remaining checklist items are still open.

Phase 3.1 in progress on 2026-10-06: all P0 client code is implemented: HMAC/Ed25519 signing, synchronized server time, Testnet-only authenticated HTTP, validated order endpoints, and user-data WebSocket subscription with account/execution events, heartbeat, reconnect, and rotation. `createTestnetTradingClient` composes these without starting network requests on construction; signed operations require fresh time. `createTestnetTradingClientFromEnv` loads exactly one signing credential, rejects production, and sanitizes key-loading errors. A read-only `smoke:trading <SYMBOL>` command loads repo-root `.env`, reads open orders, and checks user-data subscription without placing/canceling orders. Binance client: 269 tests across 20 files; build and lint pass, including a real loopback WebSocket integration test. No real Testnet authenticated request or order was sent. Phase 3.1 is NOT complete: its P1 shared gateway/market-data contracts and Binance/simulator adapters, plus real Testnet verification, remain open. Work one subphase at a time as requested: finish 3.1 before starting 3.2 lifecycle/reconciliation/executor work. Reconnect gaps require reconciliation and exchange-metadata preflight is required before unattended execution. See `docs/testnet-client.md`. Phase 1 soak monitoring remains paused; its 24h criterion is open.

Phase 3.1 completed on 2026-10-07: shared `ExchangeGateway` and `MarketDataSource` contracts are exported from `packages/core`. `packages/binance-client` now has a Binance gateway adapter around the authenticated order client and a REST-kline `MarketDataSource`; `apps/backtest-worker` now has a simulator gateway adapter around `SimBroker` and a candle-feed `MarketDataSource` adapter. Verified locally: `@meridian/core` typecheck and 36 tests across 4 files; `@meridian/binance-client` typecheck and 277 tests across 22 files; `@meridian/backtest-worker` typecheck and 361 tests across 25 files. Read-only live Testnet authentication is verified: `pnpm --filter @meridian/binance-client smoke:trading BTCUSDT` returned `openOrderCount: 0`, `userDataState: "OPEN"`, `eventsReceived: 0`, and `ordersPlaced: 0`. Live Testnet order placement/query/cancellation is verified: `pnpm --filter @meridian/binance-client smoke:trading-order -- --symbol BTCUSDT --quantity 0.0002 --confirm-testnet-order` placed a passive LIMIT BUY at `83000.91`, queried it as `NEW`, canceled it as `CANCELED`, and confirmed `stillOpen: false`.

Phase 3.2 completed in the prototype on 2026-10-08. The core order lifecycle state machine is implemented with `PENDING_NEW`, `UNKNOWN`, `PENDING_CANCEL`, terminal states, guarded transition helpers, and exhaustive focused tests. Deterministic Binance-safe `clientOrderId` generation is implemented with prefix validation, SHA-256 base64url hashing, attempt isolation, and focused tests. Write-ahead persistence foundation is implemented in `packages/db`: `orders` schema migration, `PENDING_NEW` insert repository, idempotency uniqueness, reconciliation indexes, non-terminal order scan for reconciliation, execution metadata, `order_fills`, idempotent terminal-state reconciliation update, and monotonic event-time guard for out-of-order execution reports. Timeout handling uses query-before-retry through `createQueryBeforeRetryOrderSubmitter`, which queries by `clientOrderId` after unknown placement outcomes and never blind-resends. Reconciliation has core report types plus `reconcileOpenOrders` / `runOrderReconciliation`, covering matched, missing-on-exchange, terminal-on-exchange, query-failed, terminal-local skip, and store-failure cases. Binance reconciliation exchange maps not-found signed errors to `null` while preserving transient failures. `apps/executor` has reconciliation/runtime helpers that run startup and reconnect reconciliation, apply terminal repairs, warn on unresolved missing/query-failed cases, detect possible Testnet resets, rethrow storage/repair failures so startup fails closed, and persist fee-aware user-data execution reports. The dependency factory wires DB execute + Binance query client into that runtime without creating credentials or placing orders. Follow-up 2026-10-10: REST account-trade catch-up for fills missed during executor downtime is implemented after startup/reconnect reconciliation, with exact Decimal-string fill persistence and execution/trade ID dedupe. Forward-only migration `006_order_fills_trade_id_dedupe_index` creates the trade-id dedupe index for existing databases. Live catch-up evidence exists via bounded fixture `missfill-739454811c0f4f2fb3c2`: two filled BTCUSDT IOC Testnet orders, user-data persistence intentionally skipped, reconciliation saw terminal exchange state, REST `/myTrades` persisted both fills, and own open orders ended at zero. Verified on 2026-10-08: `@meridian/core` typecheck/build/tests passed with 91 tests across 7 files; `@meridian/db` build passed, typecheck and tests passed with 28 tests across 4 files; `@meridian/binance-client` build passed, typecheck and tests passed with 288 tests across 24 files; `@meridian/executor` typecheck and tests passed with 16 tests across 4 files; `@meridian/backtest-worker` typecheck and 364 tests across 25 files.

Phase 3.3 completed in local code/tests on 2026-10-08. `packages/binance-client` exposes `createBinanceAccountClient`, and the Testnet trading client includes signed account balance snapshots behind the same synchronized clock/rate limiter as order requests. `apps/engine` has a Postgres runtime client, reads persisted `order_fills` through `createLiveFillReader`, builds `createLiveAccountState` from persisted fills plus Testnet account balances, refreshes that state before strategy startup/market execution, and injects it into the real engine runtime factory/main path. Market payloads now default to protobuf binary behind `EventCodec`: `packages/proto/proto/market_events.proto` defines the schema, `packages/proto/src/generated/market-events.ts` provides generated-style wire encode/decode, `marketEventProtobufCodec` is the default, and `marketEventJsonCodec` remains available for explicit debug/legacy use. The ingestor publishes protobuf payloads by default; the engine consumes protobuf by default and still accepts legacy JSON payloads as fallback. Next work is Phase 3.4 risk engine: orders/min, daily loss/drawdown breakers, kill switch, and persisted `risk_events`. Verified on 2026-10-08: `@meridian/proto` typecheck/build/tests passed with 5 tests; `@meridian/ingestor` typecheck/build/tests passed with 72 tests across 27 files; `@meridian/binance-client` typecheck/build/tests passed with 291 tests across 25 files; and `@meridian/engine` typecheck/build/tests passed with 37 tests across 11 files.

Phase 1.5: Ingestor close-out and soak verification.

Heartbeat review on 2026-10-06 of the original PID 21124 run: current artifacts show a timeout completion with 262,346 events received/ingested and empty stderr. The recording contains 262,346 valid JSON lines spanning only 8.033 hours (2026-10-04 12:15:59.641Z to 20:17:59.472Z), including a 7,920.465-second event gap. This is not a continuous 24h pass. Redis/Timescale are available with 262,349 entries / 262,348 trade rows; recording size is 59,736,202 bytes. These observed counts differ from the later restart/stop snapshot documented below; retain that history, but reconcile the artifacts before any rerun or completion claim. No restart was performed by this heartbeat.
Phase 2.0 completed on 2026-10-05. The Timescale candle feed, Decimal EMA crossover, next-open simulated broker with fees/slippage, return/drawdown metrics, historical runner, and executable CLI are verified end to end. Phase 2.1 core helpers, indicators, and fee-aware position/PnL accounting are complete. Phase 2.2 exchange-filter enforcement, market/limit/stop simulated broker fills, conservative intrabar ordering, recorded-session replay feed plus parity-style runtime coverage, and richer metrics are complete. Phase 2.3 reference strategies and buy-and-hold benchmark comparison are complete. Phase 2.4 saved-result flow, HTML report generation, walk-forward reporting, and worker-thread/queue sweep foundation are implemented. Backtest worker baseline: 352 tests across 23 files; typecheck passes. Invalid CLI ranges exit with status 1.

January 2024 BTCUSDT history is available for 15m and 1h, with 2,976 and 744 closed candles respectively in the exclusive-end range; continuity checks found zero gaps. Repeated real-data 15m CLI runs produced identical summaries: 128 fills, total return -0.112751%, maximum drawdown 0.144664%. The hourly run produced 28 fills, return -0.031776%, drawdown 0.049409%. Trade count means executed fills, not completed round trips; no forced final liquidation is applied.

```powershell
pnpm backtest --strategy ema --symbol BTCUSDT --from 2024-01-01 --to 2024-02-01
```

Next coding work can move to Phase 3, with one caveat: a full ≥6-month validation report still requires loading enough historical data locally. Shared Decimal helpers, exchange-filter rounding, SMA/EMA/RSI/ATR/Bollinger indicators, fee-aware simulated broker accounting, simulated exchange-filter enforcement, limit-order simulation, stop-market exits, conservative intrabar ordering, `RecordedSessionFeed`, richer metrics, determinism/parity-style runtime coverage, ATR-based EMA sizing, grid mean-reversion, buy-and-hold benchmark comparison, result-persistence schema/writer/reader, CLI save/list/show support, HTML report generation, walk-forward reporting, and queue/worker-thread sweep foundation are now implemented. Phase 1 exit criteria remain open.

Temporary web preview: `apps/web` includes a static mock Backtests / Strategy Lab page to visualize Phase 2.4 saved reports. It is not API-backed and is tracked in `docs/finishings.md` as a prototype helper to replace during the real frontend/API phase.

## Completed

- Phase 0 foundation and tooling scaffold.
- `packages/core` domain types for candles, trades, book snapshots, strategies, orders, fills, and positions.
- `packages/binance-client` REST client:
  - server time
  - exchange info
  - depth
  - klines
  - token-bucket rate limiter
  - retry with exponential backoff and jitter
  - decimal-safe REST parsers
  - fixture tests
- Stream connection manager:
  - functional factory API via `createStreamConnectionManager`
  - state machine
  - reconnect with backoff and jitter
  - stale detection
  - ping/pong timestamps
  - message listeners
  - make-before-break proactive rotation
  - subscription chunking helper
  - Prometheus metrics helper
- Stream parsers:
  - trade payload to core `Trade`
  - kline payload to core `Candle`
- Basic local order book:
  - `packages/binance-client/src/order-book/local-order-book.ts`
  - starts from snapshot levels
  - applies bid/ask updates
  - removes zero-quantity levels
  - exposes sorted snapshot, best bid, and best ask
  - tests cover sorting, updates, removals, and event time
- Initial sequence-aware depth sync:
  - `packages/binance-client/src/order-book/depth-sync.ts`
  - starts from REST snapshot `lastUpdateId`
  - ignores stale depth diff events
  - applies valid sequential depth diff events
  - marks the book `NEEDS_RESYNC` when a sequence gap is detected
- Depth sync orchestration:
  - `packages/binance-client/src/order-book/depth-sync-orchestrator.ts`
  - buffers WebSocket depth events before snapshot load
  - replays buffered events after snapshot load
  - filters events by symbol
  - triggers a fresh snapshot load after sequence gaps
- Local order book property testing:
  - `fast-check` added to `@meridian/binance-client`
  - randomized update sequences compare `createLocalOrderBook` against a simple Map-based reference model
- Local order book metrics:
  - `packages/binance-client/src/order-book/metrics.ts`
  - `order_book_resyncs_total`
  - `order_book_update_lag_seconds`
  - orchestrator exposes `getResyncCount()` and `getUpdateLagMs()`
- Phase 1.4 ingestor foundation:
  - `apps/ingestor/src/market/market-events.ts`
    - zod-validates Binance trade, kline, and depth stream payloads
    - normalizes them into decimal-safe internal market events
    - rejects malformed payloads before publish/write
  - `packages/proto/src/index.ts`
    - exposes `MarketEventMessage`, `EventCodec<TMessage>`, `marketEventJsonCodec`, `encodeMarketEvent`, and `decodeMarketEvent`
    - current codec is stable JSON bytes with Decimal values serialized as strings
  - `apps/ingestor/src/market/market-publisher.ts`
    - encodes normalized events and publishes Redis Stream field payloads via injected `xadd`
    - routes to `market.trade.*`, `market.kline.*`, and `market.book.*`
  - `apps/ingestor/src/market/market-batch-writer.ts`
    - deduplicates by event kind, symbol, and event id within a batch
    - sends trades and klines to upsert callbacks; ignores depth for this DB writer
  - `apps/ingestor/src/adapters/timescale-market-writer.ts`
    - builds multi-row SQL `INSERT ... ON CONFLICT` statements for `trades` and `klines`
    - serializes Decimal values as strings for numeric DB columns
  - `apps/ingestor/src/market/market-ingestor.ts`
    - orchestrates normalize → publish → batch write
    - malformed events reject before publish/write
  - `apps/ingestor/src/market/market-ingestor-factory.ts`
    - wires injected/default event codec, publisher, and batch writer behind `createMarketIngestor`
  - `packages/db/src/market-data-migrations.ts`
    - defines Timescale market data schema for `trades` and `klines`
    - includes hypertable setup and unique keys for idempotent upserts
  - `packages/db/src/migration-runner.ts` and `packages/db/src/postgres-adapter.ts`
    - run SQL migrations once using `schema_migrations`
    - adapt a Postgres-style `query(text, values)` client to migration dependencies
  - `apps/ingestor/src/runtime/startup-migrations.ts`
    - runs market data migrations during ingestor startup
  - `apps/ingestor/src/adapters/redis-stream-adapter.ts`
    - adapts a Redis-style `xAdd` client to the publisher's injected `xadd`
  - `apps/ingestor/src/adapters/postgres-market-writer-factory.ts`
    - adapts a Postgres-style client to the Timescale market writer
  - `apps/ingestor/src/runtime/app-bootstrap.ts`
    - composes Redis, Postgres, migrations, metrics, and ingestion behind `createIngestorApp`
  - `apps/ingestor/src/runtime/lifecycle.ts`
    - guards start/stop lifecycle and prevents ingest before startup or after stop
  - `apps/ingestor/src/runtime/metrics.ts` and `apps/ingestor/src/market/instrumented-ingestor.ts`
    - registers Prometheus counters for processed, failed, published, and persisted events
    - wraps ingestion to record metrics around success/failure
  - Historical kline backfill foundation:
    - `kline-backfill-planner.ts` chunks date ranges into Binance kline REST windows
    - `kline-backfill-runner.ts` fetches planned windows and persists returned candles
    - `binance-backfill-adapter.ts` adapts Binance REST klines to core candles
    - `kline-backfill-service.ts` composes Binance + Postgres dependencies
    - `kline-backfill-cli.ts` and `kline-backfill-command.ts` parse CLI flags and run the service
  - Runtime wiring:
    - `apps/ingestor/src/runtime/runtime-clients.ts` creates real Postgres and Redis clients behind testable ingestor interfaces
    - `apps/ingestor/src/main.ts` loads config, connects Redis/Postgres, creates Binance REST + metrics dependencies, runs startup migrations, dispatches live startup or kline backfill mode, and closes clients on completion
- Initial `packages/bus` Redis Streams helper API:
  - keeps stable stream-name helpers for market, signals, orders, and control streams
  - adds injected-client helpers for publish, consumer group creation, group reads, ack, and stale pending message claim
  - adds a Redis command adapter for `XADD`, `XGROUP CREATE`, `XREADGROUP`, `XACK`, and `XAUTOCLAIM`
  - unit-tested with mocked Redis client behavior and smoke-tested against local Docker Redis
  - Session recorder foundation:
    - `apps/ingestor/src/market/session-recorder.ts` appends normalized events to replayable NDJSON
    - serializes Decimal values as strings for trade, kline, and depth events
    - optionally records normalized events inside `ingestMarketStreamEvent` before publish/write
    - runtime config is opt-in via `INGESTOR_SESSION_RECORDING_PATH`
    - unit-tested with injected filesystem dependencies, config coverage, and ingestion-order coverage

## Current Verification Baseline

Latest verified package checks:

- `@meridian/binance-client`
  - Typecheck passed.
  - Build passed.
  - Tests passed: 305 tests across 26 test files, including fixed-point gateway serialization regressions, Binance reconciliation exchange behavior, cumulative quote quantity parsing from user-data execution reports, signed account-balance client wiring, and signed account-trade catch-up parsing.
- `@meridian/proto`
  - Typecheck passed.
  - Build passed.
  - Tests passed: 5 tests across 1 test file, including protobuf binary default codec coverage and explicit JSON debug codec coverage.
- `@meridian/ingestor`
  - Typecheck passed.
  - Build passed with dependent packages via `pnpm --filter @meridian/ingestor... build`.
  - Tests passed: 72 tests across 27 test files.
- `@meridian/config`
  - Typecheck passed.
  - Tests passed: 1 test across 1 test file.
- `@meridian/db`
  - Typecheck passed.
  - Build passed.
  - Tests passed after write-ahead conflict regression fixes, reconciliation local-order scan, terminal-state reconciliation update, live execution metadata, fee-aware fill persistence, and trade-id fill dedupe: 53 tests across 6 test files. Temporary-table PostgreSQL retry/conflict verification also passed.
- `@meridian/bus`
  - Typecheck passed.
  - Tests passed: 15 tests across 1 test file.
- `@meridian/core`
  - Typecheck passed.
  - Build passed.
  - Tests passed: 91 tests across 7 test files, including partial-fill/cancellation race regressions and report-only order reconciliation.
- `@meridian/executor`
  - Typecheck passed.
  - Build passed.
  - Tests passed: 139 tests across 22 test files for startup/reconnect reconciliation composition, REST account-trade catch-up, terminal repairs, fail-closed storage/repair errors, executor runtime startup gating, dependency factory wiring, real runtime-client adapters, signal consumption/execution, durable risk checks, kill switch behavior, service-loop/main-runner sequencing, Prometheus expiry metrics, user-data order update handling, partial fills, and fee-aware fill persistence.
- `@meridian/engine`
  - Typecheck passed.
  - Build passed.
  - Tests passed: 37 tests across 11 test files for signal publishing, live strategy running, live account state, persisted fill reading, protobuf/EventCodec-backed market consumption, engine runtime/factory wiring, runtime-client adapters, service-loop/main-runner sequencing, and main-entry delegation.
- `@meridian/backtest-worker`
  - Typecheck passed after simulator gateway and candle-feed market-data adapters.
  - Tests passed: 364 tests across 25 test files, including explicit simulator fill identity regressions.

Latest local infrastructure smoke checks:

- Docker Compose infra is running locally: Redis, TimescaleDB, Prometheus, and Grafana.
- Redis responds to `PING`.
- TimescaleDB accepts connections.
- Ingestor startup applied `001_market_data_schema` against real TimescaleDB.
- Bounded kline backfill smoke wrote 6 `BTCUSDT` 1m candles for `2024-01-01T00:00:00Z` through `2024-01-01T00:05:00Z`.
- Redis publish smoke wrote a normalized trade event to `market.trade.BTCUSDT` and verified the stream entry fields.
- Bounded live ingest smoke consumed 2 real public `BTCUSDT` trade events from Binance production WebSocket, published them to Redis, and wrote 2 trade rows to TimescaleDB.
- Phase 1.5 soak was restarted on 2026-10-05 with PID `24416` after confirming the old documented PID was no longer running, then manually stopped the same day before the 24h exit criterion:
  - command mode: `smoke-live-ingest --symbol BTCUSDT --events 5000000 --timeoutMs 86400000 --environment production`
  - stdout log: `logs/soak/phase-1-5-live-ingest.out.log`
  - stderr log: `logs/soak/phase-1-5-live-ingest.err.log`
  - session recording: `sessions/soak/phase-1-5-events.ndjson`
  - stop snapshot: Redis `market.trade.BTCUSDT` length 1,071,912; Timescale `BTCUSDT` trade rows 536,742; recording size 121,784,825 bytes.

Run:

```powershell
pnpm --filter @meridian/binance-client typecheck
pnpm --filter @meridian/binance-client test
pnpm --filter @meridian/proto typecheck
pnpm --filter @meridian/proto test
pnpm --filter @meridian/ingestor typecheck
pnpm --filter @meridian/ingestor test
pnpm --filter @meridian/db typecheck
pnpm --filter @meridian/db test
pnpm --filter @meridian/bus typecheck
pnpm --filter @meridian/bus test
pnpm --filter @meridian/config typecheck
pnpm --filter @meridian/config test
```

## Next Work

### Phase 3.4 Complete Locally (2026-10-08)

Codex implemented this subphase at the user's explicit request. The executor now wires durable risk reservations, per-symbol/strategy limits, global exposure/open-order limits, sliding-minute rates, UTC daily realized loss, durable equity drawdown, price sanity/freshness, an authenticated-reset fail-closed kill switch, cancellation retries during idle/outage periods, and audit-before-ACK rejection persistence. Migration 005 starts engaged; no automatic activation or peak/loss clearing occurs. See `docs/risk-engine.md` and `.env.example` before operator activation.

Verification: 1,052 tests across 124 files, including five isolated PostgreSQL tests; changed/dependent builds and affected lint pass. No live exchange orders were placed/canceled, no real Redis risk flags were changed, and application DB tables were not migrated during verification. Next: Phase 3.5 integration/parity/crash/fail-closed verification. The 48h Testnet run and live cancellation timing are not passed yet. Soak monitoring remains paused.

### Phase 3.3 Review Fixes (2026-10-08)

- The real executor now requires a configured risk gate, starts authenticated user-data tracking, persists order updates, and waits for reconciliation before startup/reconnect execution. Persistence or unresolved reconciliation failures block execution.
- Engine and executor signed clients opt into automatic server-clock refresh; refresh failure cannot authorize a signed operation.
- Submission is claimed atomically in PostgreSQL (`PENDING_NEW` -> `UNKNOWN`) before sending. Redis redelivery queries an already claimed order instead of placing it again. Missing/ambiguous exchange results remain blocked until operator reconciliation. The authenticated `resolve-unknown` control command queries the exchange by `clientOrderId` and only marks the local order `EXPIRED` with audit evidence when the exchange returns not found; exchange-found or query-failed outcomes do not mutate local state. Never reset an `UNKNOWN` record and retry blindly.
- Signal expiry is checked after risk evaluation, persistence, and submission claim. Already persisted records may remain pending/unknown when expiry interrupts processing.
- Prototype runtime defaults: `EXECUTOR_MIN_NOTIONAL=5`, `EXECUTOR_MAX_NOTIONAL=25`, `EXECUTOR_MAX_QUANTITY=0.0002`, `EXECUTOR_MAX_POSITION=0.001`, `EXECUTOR_MAX_OPEN_ORDERS=1`. These are conservative bootstrap limits, not a completed Phase 3.4 risk engine. Existing Testnet base-asset holdings count toward the position limit and can cause rejection. Limits are configurable through environment variables.
- Verification: 600 tests across 90 files passed for engine, executor, Binance client, DB, core, protobuf, and ingestor. Changed packages build successfully. No live exchange orders were placed/canceled for these fixes; full live integration/crash testing remains open in Phase 3.5.

### Live Monitoring Dashboard

- Read-only local dashboard at `http://127.0.0.1:5173` with a Fastify API at `http://127.0.0.1:3000`.
- Shows BTCUSDT prices and volumes from the latest 500 Redis trade events, recent trades with side filtering, Redis/Timescale counts, Redis memory, recording size, and soak elapsed time.
- Refreshes every 2 seconds; Timescale counts are cached for 15 seconds. Counts are cumulative and include earlier smoke events.
- Reports stale/unavailable data and recording inactivity. A finished CLI result still requires review before marking the 24-hour soak passed.
- Local dashboard server logs and browser-check screenshots are under ignored `logs/dashboard/`.
- To restart after closing the servers, run these in separate terminals from the repository root:

```powershell
pnpm --filter @meridian/api build
node apps/api/dist/main.js
```

```powershell
pnpm --filter @meridian/web dev
```

Redis/Timescale must be running. `DATABASE_URL` and `REDIS_URL` can override the default local connections. The dashboard currently monitors the fixed Phase 1.5 BTCUSDT soak paths.

Continue Phase 3.2 order lifecycle next. Soak monitoring is paused. The Phase 2.0 January backfills do not satisfy the six-month, three-symbol 1m backfill requirement. Remaining Phase 1 work:

- when explicitly resumed, reconcile existing run artifacts and perform a fresh uninterrupted 24h soak; summarize Redis/Timescale/session counts before claiming a pass
- after soak: spot-check book state against a fresh REST snapshot, run the 60s network-kill recovery test, and complete the longer historical backfill exit criterion
- later: continuous aggregates/compression and generated protobuf/buf behind the existing `EventCodec` boundary

## GitHub / Repository Note

The project was pushed to the user's personal GitHub from an isolated Docker git environment, not from the Windows/office GitHub setup.

Docker setup used:

- container name: `meridian-git`
- mounted repo path: `/workspace`
- persistent Docker home volume: `meridian-git-home`
- personal SSH key lives inside the Docker volume, not in the Windows user profile
- expected personal remote shape: `git@github.com:amandwivedi1357/meridian.git`

To reuse:

```powershell
docker start -ai meridian-git
```

Then inside the container:

```bash
cd /workspace
git status
git remote -v
```

Avoid pushing from the normal Windows PowerShell Git setup if it is configured for office GitHub.

## Important Notes

- Use `Decimal`, never `parseFloat`, for money and quantities.
- Binance stream payloads are JSON text, not binary.
- Keep functionality small and testable.
- Mark completed plan items in `docs/implementation-plan.md`.
