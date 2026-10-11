# Scripts

Project automation will live here, including backfill commands, chaos tests, and benchmark helpers.

`node scripts/setup-dashboard-auth.cjs` configures local viewer/operator credentials and
a JWT secret in the ignored `.env`, preserving existing valid values. It adds localhost
and loopback Vite origins without printing secrets. Restart the API afterward. Use
`API_OPERATOR_TOKEN` in the dashboard's Sign in field to launch simulations, or
`API_VIEWER_TOKEN` for read-only access. These are local dashboard credentials, not
Binance API keys. Sessions expire after 15 minutes; no trading services are started.

## Continuous Dashboard Market Feed (Windows)

Normal dashboard ingestion no longer has a one-hour lifetime. It uses public production
BTCUSDT trades, depth and 1m/5m/15m/1h candles; it never starts the trading engine,
executor or session recorder. Redis streams retain approximately 2,000 entries each;
the ingestion queue is capped at 1,000. PostgreSQL history remains durable on disk and
still needs a separate retention/compression policy. Service logs rotate at 5 MiB,
keeping one previous file: `logs/dev/dashboard-feed.log` and `.log.1`.

```powershell
corepack pnpm --filter @meridian/ingestor build
corepack pnpm dashboard:feed:install
corepack pnpm dashboard:feed:status
corepack pnpm dashboard:feed:stop
```

The installer registers `Meridian Dashboard Public Feed` for the current user's login,
with limited privileges, no execution time limit and one task instance. It starts now
and at future logins. The process retries dependency/ingestion failures with capped
backoff, recovers stale sockets, and renews a Redis ownership lease to prevent duplicate
publishers. Task Scheduler also retries unexpected process exits. A forced stop can
leave the lease until its 30-second expiry; the next process retries automatically.
To restart manually, run `powershell -NoProfile -ExecutionPolicy Bypass -File
scripts/dashboard-feed-task.ps1 -Action Start`. `-Action Remove` removes the login task.

Docker Desktop, Redis and Timescale must be available; enable Docker Desktop's login
startup separately. No feed can stream while the laptop is asleep/off or disconnected.
This task starts only the feed, not the API/Vite servers. Launch those separately.
For foreground troubleshooting use `corepack pnpm dashboard:feed` after stopping the
task. Keep other publishers for the same BTCUSDT topics stopped; older ingestor modes
do not participate in this dashboard-specific lease.

The explicitly bounded preview remains available as
`node --env-file=.env apps/ingestor/dist/smoke/dashboard-feed.js` (one hour by default,
`DASHBOARD_FEED_DURATION_MS` accepts 1 second to 1 hour). It shares the lease with the
continuous feed and cannot publish concurrently. Use it only after stopping the task.

## Dashboard Recovery And Latency Verification

Build the API and web app first, then run `node apps/web/scripts/verify-recovery.cjs`
with explicit `API_TEST_DATABASE_URL`, `API_TEST_REDIS_URL` and (when needed)
`PLAYWRIGHT_MODULE`. Chrome must be installed. The script starts temporary API
subprocesses and a production UI preview, using random cookie credentials, a unique
database schema and namespaced Redis. It kills/recreates the API on the same port,
checks retained-cursor replay and account recovery without page reload, then deletes
test-owned history to verify expired-cursor rebootstrap. Only public market bootstrap
and dependency health are synthetic; Redis decoding, authenticated SSE, account DB
reads and the UI are real. No exchange client, engine or executor starts.

Fifty controlled trade updates are measured across desktop, post-restart and mobile.
The latency metric covers fixture generation, Redis, API delivery and DOM update plus
two animation frames; it excludes exchange/network ingestion and is a local rendering
proxy, not a hardware display measurement or a 500-client benchmark. Every sample must
be under one second. Silent SSE connections are recovered after 45 seconds without
ready/data/health/heartbeat (checked every five seconds), using the existing backoff;
healthy channels do not poll REST. Expect two real heartbeat-timeout windows during
the crash tests. Logs/screenshots are under `logs/verification/phase-4-2/recovery-*`.
The test snapshots shared order/fill/audit/control/kill state and requires it unchanged;
its subprocesses, schema and Redis keys are removed afterward.

## 500-Connection SSE Load Acceptance

`node scripts/verify-sse-load.cjs` requires explicit `API_TEST_DATABASE_URL`,
`API_TEST_REDIS_URL` and `K6_BINARY` pointing to k6 with the `k6/x/sse` extension.
The verified toolchain is k6 v2.3.0 plus `github.com/phymbert/xk6-sse@v0.2.0`.
Automatic extension resolution was unavailable for this module during verification;
the Windows binary was cross-built in a disposable official xk6 Docker container:

```powershell
New-Item -ItemType Directory -Force logs/verification/tools
$tools = (Resolve-Path logs/verification/tools).Path
docker run --rm --mount "type=bind,source=$tools,target=/xk6" -e GOOS=windows -e GOARCH=amd64 grafana/xk6@sha256:2bf2f319554253656a00fa9224bc7b40bc401e45b9f04041074d62e39561c084 build v2.3.0 --with github.com/phymbert/xk6-sse@v0.2.0 --output /xk6/k6-sse.exe
$env:K6_BINARY = (Resolve-Path logs/verification/tools/k6-sse.exe).Path
# Set API_TEST_DATABASE_URL and API_TEST_REDIS_URL to your local test infrastructure.
node scripts/verify-sse-load.cjs
```

Only the tools directory is mounted into the build container. No system install, PATH
change or project credential mount is required. Extension source:
[xk6-sse](https://github.com/phymbert/xk6-sse); builder workflow:
[Grafana extension documentation](https://grafana.com/docs/k6/latest/extensions/run/).

The runner creates a unique DB schema/Redis namespace and one temporary API subprocess
using actual authentication, gateway rate limits, Redis decoding/SSE, account DB reads,
portfolio accounting and cached dependency-health reads. It never starts an exchange
client or trading runtime. Two 250-connection cohorts open 61 seconds apart to respect
the unchanged 300-requests/minute/IP limit. Exactly 250 market and 250 account SSE
connections must remain simultaneously active for at least 60 seconds, with no
replacement sockets, resyncs or errors. This is 500 streams, not 500 two-stream browser
sessions. All clients must see ready/update/heartbeat/completion events and close cleanly.

Synthetic workload targets 20 trades/second plus a depth, 15m candle and isolated account
DB update each second. Actual counts, sampled API RSS/heap/CPU/event-loop delay, k6
delivery latency (including ramp and steady state) and socket lifecycle are saved in
`logs/verification/phase-4-2/sse-load.json` and `sse-k6-summary.json`. Market delivery p95
must be under one second; this is SSE receipt, not browser paint or exchange latency.
The runner requires shared order/fill/audit/control/kill state unchanged and removes its
processes, schema and namespaced keys. Failed attempts write `sse-load-failure.json`;
do not treat them as acceptance evidence. The test is a short local capacity check,
not a long soak, production-size order history benchmark or Internet deployment test.

# Seven-page UI Verification

The current UI has Overview, Market, Trading, Risk, Strategies, Backtests and System with left-rail hash navigation (`/#/market`, etc.). `apps/web/scripts/verify-workspace.cjs` supersedes the legacy combined-dashboard `verify-terminal.cjs` for layout checks. With API/Vite/public feed already running, set `PLAYWRIGHT_MODULE` to the installed Playwright module path and run `node apps/web/scripts/verify-workspace.cjs`. It uses a read-only viewer session, checks all seven pages at 1440px and 390px, timeframe chart framing, real audit/migration/report reads, and intercepted mock STOP/RESUME confirmations. It does not start trading or write actual controls. Evidence goes to ignored `logs/verification/workspace/`. The backtest/control/recovery harnesses now use the new page navigation. Storage/config/audit reads are sampled on entry/manual refresh; healthy market/account/system-health remain SSE-driven.

## Phase 5 Observability Verification

With the API, public feed, Prometheus and Grafana running, set `GRAFANA_VERIFY_PASSWORD`
in the verification shell (and optionally `GRAFANA_VERIFY_USER`, default `admin`) and
run `node scripts/verify-observability.cjs`. It checks actual active API/feed scraper
targets, available storage/fresh upstream metrics, idle dispatcher readiness,
all fourteen evaluated rule health states, all three provisioned dashboards and
every panel's PromQL syntax. Installed Chrome is used
for authenticated screenshots; override `PLAYWRIGHT_MODULE` when needed. Results go to
ignored `logs/verification/phase-5/`. No service activation or trading/control action
occurs; stopped trading targets remain down and no financial values are fabricated.

Run alert fixtures with the pinned Prometheus image and a read-only mount:

```powershell
docker run --rm --entrypoint /bin/promtool --mount "type=bind,source=$((Resolve-Path infra/prometheus).Path),target=/verification,readonly" prom/prometheus:v2.54.1 test rules /verification/tests/meridian.yml /verification/tests/telemetry.yml
```

This is rule logic/provisioning acceptance, not chaos testing, notification delivery,
production throughput or long-run trading acceptance.

## Telegram Alerts

After setting `TELEGRAM_BOT_TOKEN` (or `MERIDO_BOT_TOKEN`) in ignored `.env` and
sending `/start` to the bot, run `node --env-file=.env scripts/setup-telegram-alerts.cjs`.
Only one distinct private destination is auto-selected; set `TELEGRAM_CHAT_ID` for
multiple chats. Secret config is generated in ignored `infra/alertmanager/.local/`,
not logs. Do not upload that folder or print Alertmanager config/status responses.
Start only Alertmanager with `docker compose -f infra/docker-compose.yml --profile
alerts up -d --no-deps alertmanager`, then reload Prometheus with `docker kill --signal
HUP infra-prometheus-1`. Rerun setup plus `docker kill --signal HUP infra-alertmanager-1`
after configuration/token changes. `node scripts/verify-telegram-alerts.cjs` sends a
bounded synthetic firing/resolved check and records Telegram API acceptance counters;
it does not prove a human read receipt. Unit tests: `node scripts/setup-telegram-alerts.test.cjs`.
Local Engine/Executor notifications are suppressed by default; explicitly set
`TELEGRAM_TRADING_ALERTS=true` and regenerate/reload when those services should run.
Other operational notifications are enabled; no trading/control commands are exposed.

## Isolated Chaos And Linux Shutdown

Run `node scripts/verify-chaos.cjs` with Docker Desktop available. It uses the
installed esbuild runtime and pinned-major Redis 7/Postgres 16/Node 22 Alpine
fixtures, creates a unique internal network and publishes no ports. Only its
generated credential-free bundle is mounted; project `.env`, running services,
data volumes and exchange clients are never used. Network cut, Redis kill/restart,
fixture safety-runtime crash/restart, duplicate/older execution updates, actual
Linux SIGTERM drain and hung-cleanup deadline are checked. Cleanup validates
ownership labels and removes only test-owned containers/anonymous volumes/network;
success evidence is written after cleanup to `logs/verification/phase-5/chaos/result.json`.
Failed attempts write `failure.json` and do not count as acceptance.

The shared guard defaults to `SHUTDOWN_TIMEOUT_MS=15000`. Engine/Executor do not
start merely for shutdown testing; this harness exercises their production safety
components, not a complete deployed trading service. See `docs/observability.md`
for exact scope and remaining deployed trading-service signal acceptance. The harness
also bundles actual API/backtest/legacy-ingestor/job entrypoints and signals them during
controlled startup/read waits; these are simulation/public-data runtimes, not trading.

## Actual Executor Runtime Chaos

Run `node scripts/verify-executor-chaos.cjs` with Docker Desktop available.
It bundles the production Executor entrypoint/service loop and real risk, storage,
REST signing, user-data WebSocket and reconciliation components. A build-only
adapter redirects the exchange to a local signed REST/WS simulator with fixed
fake credentials. An internal UUID-labeled Docker network has no published ports;
only generated bundles are mounted read-only, never the checkout/.env/project data.
The simulator initializes only its new DB kill state and permits two active risk
reservations for two 0.0001 BTC / 8.1 USDT synthetic LIMIT orders. Production defaults
are unchanged. It asserts a durable UNKNOWN claim before every exchange send.

Checks cover actual startup/readiness, duplicate signals, duplicate/older WS fills,
SIGKILL after exchange acceptance before signal ACK and stale reclaim without resend,
Redis network blackhole with durable kill/cancellation, Redis kill/AOF restart,
Executor network isolation/reconnect, and bounded Linux SIGTERM cleanup. Redis commands
in production Executor now have a 5s deadline; timeout destroys the socket so a stuck
blocking read cannot starve safety ticks. This is not permission to blindly retry
ambiguous submissions. Production XREADGROUP blocks for 1s, below that deadline.

Evidence: unique `logs/verification/phase-5/executor-chaos-<uuid>/result.json` only
after verified ownership cleanup; failed attempts retain failure.json. This is actual
main/runtime wiring with a simulated exchange, not unmodified deployed-image or real
Binance/Testnet outage acceptance, performance or soak. No trading service is launched
against project storage; no shared kill/allocation mutation occurs.

## Isolated Ingestion Benchmark

Run `node scripts/verify-ingest-ablation.cjs` for bottleneck diagnosis: three
interleaved 60s Linux mixed 2k/s trials each of `full`, `no-db`, `no-redis` and
`normalize-only`. Same feeder, batching and combined service quotas; inactive
services keep their limits, with no CPU redistribution. Each trial uses fresh
credential-free storage and ownership-checked cleanup. Summary/progress/logs are
under `logs/verification/phase-5/ablation-<uuid>/`. Failed trials are retained;
exit1 means at least one fixture failed, not that its measured results vanish.
Individual trials accept `BENCHMARK_ABLATION` with those four values (default full).
Normalization-only skips codec and batching as well as storage, so it is a CPU
floor, not a like-for-like Redis transport measurement. Stub publication latency
is NOT real Redis acknowledgement or TRD acceptance; diagnostic metrics may count
simulated publications/persistence. Disabled stores must remain empty; enabled
stores and stub counters must exactly match accepted events. Shared feed/trading
state is untouched. Unit tests: `node --test scripts/verify-ingest-ablation.test.cjs
scripts/verify-ingest-repeats.test.cjs`.

Repeat the fixed Linux 2k mixed workload sequentially with
`node scripts/verify-ingest-repeats.cjs`. `BENCHMARK_REPEATS` accepts3-5 (default3).
Every trial gets a unique directory; `repeat-<uuid>/summary.json` reports per-run
p95/p99 median/range, throughput, refusals and unscheduled events. Failing measured
trials are included; missing/invalid reports are listed separately, not silently
discarded. Exit1 means original local performance gates failed, not that results
should be ignored. No exchange access, shared-data resets or trading activation.
The helper's unit tests: `node --test scripts/verify-ingest-repeats.test.cjs`.

For a separate fixed normal-load check use `BENCHMARK_RATE=250`,
`BENCHMARK_TOPICS=mixed`, `BENCHMARK_BATCH=1`, `BENCHMARK_HOST=windows`,
`BENCHMARK_PROFILE=0` and a unique `BENCHMARK_VARIANT`. This is one synthetic
BTCUSDT HTTP-fixture workload, not a three-symbol/live-WebSocket traffic guarantee.

Run `node scripts/verify-ingest-benchmark.cjs` with Docker Desktop available and
`K6_BINARY` pointing to a local k6 executable. On this laptop the default is the
existing ignored `logs/verification/tools/k6-sse.exe`; no extension is required for this test.
It generates a credential-free production-component bundle, creates disposable Redis
and Timescale containers on random loopback-only ports and uses four k6 VUs for 60s.
The fixture's HTTP listener is loopback-only. No `.env`, exchange/trading runtime,
shared database/Redis keys or user-defined destinations are used.
Count equality, protobuf decode, successful drain and ownership-checked cleanup are
required before writing the named variant's `result.json` under `logs/verification/phase-5/`.
Default is `profile-buffered`; select `BENCHMARK_MODE=serial` and a distinct
`BENCHMARK_VARIANT` for comparison. `BENCHMARK_VUS=64` increases closed-loop trade
load. Set `BENCHMARK_RATE=2000`, `BENCHMARK_TOPICS=mixed`, `BENCHMARK_HOST=linux`
for the bounded Linux offered-load test; combined service CPU quotas are 2 and RAM
limits 2GiB, excluding host/OS/k6. Storage ports are not published in Linux mode;
only synthetic HTTP is published to loopback on a private Docker bridge. No exchange
client or credentials are included. `BENCHMARK_BATCH=20` groups feeder transport,
but every event's latency is sampled individually including generation/queue wait.
`BENCHMARK_PROFILE=0` disables V8 sampling overhead for a separate named run.
Profiled runs save `ingestor.cpuprofile`; stage samples cap at 100,000 observations.
Reports distinguish fixture integrity (`passed`), target checks and unscheduled events.
Use `BENCHMARK_RATE=20000`, `BENCHMARK_BATCH=200`, `BENCHMARK_TOPICS=mixed`,
`BENCHMARK_HOST=linux`, `BENCHMARK_PROFILE=0`, `BENCHMARK_CPU_PERIOD=10000` and a
unique variant for the 60s burst. Expected bounded-queue 503s are counted separately;
all accepted events must match Redis entries-added and durable trade/candle counts.
`targetChecks.burst20k` additionally requires no unscheduled events and all 1.2M
offered events accounted for. It is overload tolerance, not 20k/s accepted throughput.
CPU period can be 10000 or 100000 microseconds. Optional `BENCHMARK_REDIS_CPU`
(0.125/0.25/0.5) keeps the total allocation at two CPU; default 0.25 is unchanged.
`BENCHMARK_SEMI_SPACE=32` is an experimental V8 setting, not a recommended default.
Measured tuning regressions are in `docs/benchmark.md`; do not promote failed runs.
Nonzero k6 thresholds produce a failing report/exit rather than successful acceptance.
Failed setup attempts are not evidence; coordinator keepalive covers fetch-only waits,
and ownership-checked cleanup removes only that run's containers/network.
See `docs/benchmark.md` for exact scope, numbers and unmet TRD targets.

Executor crash tests (simulated exchange, disposable storage):

```powershell
$env:RUN_EXECUTION_INTEGRATION='1'
node node_modules/vitest/vitest.mjs run apps/executor/src/execution-loop.integration.test.ts
Remove-Item Env:RUN_EXECUTION_INTEGRATION
```

All eight pass on this laptop. They exercise the production signal-processing child,
not the full deployed Executor or a real exchange outage. No live orders are sent.

## Application Image Verification

`node scripts/containers/observability-config.cjs` renders container scrapes/probes
for `COMPOSE_PROFILES`; use exactly the same profiles when starting Compose.
`node scripts/verify-container-observability.cjs` checks actual isolated API/feed/
Web metrics and four provisioned Grafana dashboards,then verifies disposable Redis
outage -> real Prometheus rule -> two Telegram firing/resolved sends. It uses the
existing private destination,does not activate trading or touch shared storage,
and removes its private config/fixtures. Results/screenshots are ignored logs.
See `docs/containers.md` for full setup and acceptance scope.

`node scripts/verify-containers.cjs` builds six non-root application images and
verifies packaging/startup/proxy/SSE/shutdown on disposable internal storage,
without real credentials, trading or shared service restarts. `--skip-build`
rechecks existing image IDs. See `docs/containers.md` for scope and Compose usage.
