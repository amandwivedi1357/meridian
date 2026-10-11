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

## Isolated Ingestion Benchmark

Run `node scripts/verify-ingest-benchmark.cjs` with Docker Desktop available and
`K6_BINARY` pointing to a local k6 executable. On this laptop the default is the
existing ignored `logs/verification/tools/k6-sse.exe`; no extension is required for this test.
It generates a credential-free production-component bundle, creates disposable Redis
and Timescale containers on random loopback-only ports and uses four k6 VUs for 60s.
The fixture's HTTP listener is loopback-only. No `.env`, exchange/trading runtime,
shared database/Redis keys or user-defined destinations are used.
Count equality, protobuf decode, successful drain and ownership-checked cleanup are
required before writing `logs/verification/phase-5/ingest-benchmark/result.json`.
See `docs/benchmark.md` for exact scope, numbers and unmet TRD targets.
