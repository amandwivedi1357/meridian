# Observability

Phase 5 is in progress. This first slice implements private diagnostics for the API,
continuous public dashboard feed, Engine and Executor. The backtest worker is a
short-lived job process, not a permanently running service; its diagnostics and
dispatcher now reports readiness and local child-process lifecycle metrics through
the API registry. Durable job-state populations are sampled from committed database rows.

## Endpoints

Each running service exposes `GET /metrics`, `/health/live` and `/health/ready`
on a separate diagnostics listener. Defaults are loopback only:

| Service                | Port override               | Default port |
| ---------------------- | --------------------------- | ------------ |
| API                    | `API_DIAGNOSTICS_PORT`      | 9400         |
| Continuous public feed | `INGESTOR_DIAGNOSTICS_PORT` | 9401         |
| Engine                 | `ENGINE_DIAGNOSTICS_PORT`   | 9402         |
| Executor               | `EXECUTOR_DIAGNOSTICS_PORT` | 9403         |

These endpoints are not authenticated. Do not proxy them through public ingress.
`DIAGNOSTICS_HOST` defaults to `127.0.0.1`. Docker Desktop Prometheus uses
`host.docker.internal` in `infra/prometheus/prometheus.yml`; loopback listeners
are not guaranteed to be reachable from that container. Only set
`DIAGNOSTICS_HOST=0.0.0.0` after restricting these ports to the trusted scraper
with a firewall/private network. No binding or firewall change is made automatically.
Local verification on Docker Desktop (2026-10-11) successfully scraped the existing
loopback API and public-feed listeners via `host.docker.internal`; this is host-specific,
not a guarantee for other Docker/Linux/cloud networking setups.
An inactive service or unreachable listener should show `up=0`, not invented health.
Do not launch Engine or Executor merely to make Grafana green: they can trade.

Readiness remains false until startup succeeds. API readiness checks Redis and
database availability. Feed readiness requires an open, recently active upstream
connection and a valid local lease deadline. Engine/Executor additionally require
recent successful polling and database access; Executor checks Redis and user-data
tracker readiness. Checks time out after two seconds and share in-flight work.
This is operational readiness, not market freshness/strategy approval or permission
to trade. A global kill switch can remain engaged while the service is ready.

On SIGINT/SIGTERM these runtimes latch stopping/not-ready before draining their
existing work and closing resources; diagnostics connections are force-closed
after 250ms. API, continuous feed, Engine and Executor now share a total signal-triggered
shutdown deadline: `SHUTDOWN_TIMEOUT_MS` defaults to 15,000ms, accepts integers
100-120,000ms and exits nonzero if draining/cleanup hangs. Repeated signals do not
extend it; successful cleanup removes signal handlers and cancels the deadline.
Engine blocks new signal publication during stopping; Executor checks stopping
before final risk evaluation and immediately before submission, including after
asynchronous readiness/kill checks. Already-started operations may drain.
Shutdown does not clear kill state or cancel all exchange orders; ambiguous submissions
remain subject to the existing write-ahead/reconciliation rules. SIGKILL/forced OS
termination cannot run these handlers.
Standalone backtest, backtest job child and legacy ingestion CLI now use the same
deadline. Cancellation stops replay/batch work and prevents backtest success publication;
accepted live-smoke writes drain before clients close. Deployed trading-service/startup
coverage remains open. API/Engine/Executor guards are installed before asynchronous
initialization; a startup cancellation cannot start the runtime loop/dispatcher.

## Metric Scope

- Node runtime metrics carry a `service` label.
- `meridian_service_ready` and `meridian_service_stopping` report lifecycle state.
- Engine/Executor export operation counts, failures and duration histograms.
- API request counts/durations use route templates, not IDs, tokens or query values.
  SSE duration represents the complete stream lifetime, not request latency.
- The feed exports ingestion counters, queue depth, upstream message age and
  connection-manager reconnect attempts. Counters survive supervisor retries.
  `ws_reconnect_attempts` remains a compatibility gauge that resets with the connection manager.
  `ws_reconnects_total` counts scheduled attempts across supervisor retries. Error/close
  pairs schedule/count only once; initial opens and planned rotations are not retries.
  It resets on process restart, not supervisor retry; use Prometheus `increase()`.
- `ingestor_operation_duration_ms` includes DB work. It is not the TRD's pure
  ingest-to-bus latency and cannot establish that latency target.
- `ingest_to_bus_latency_ms` measures local receipt through successful Redis publication,
  including queue wait, normalization and optional recording, excluding the subsequent DB
  write and upstream network. Legacy ingestion starts timing at ingest entry. Failed
  publications have no successful latency observation; bus success still counts if DB fails.
- API-observed dependency availability, retained stream lengths and sample timestamp
  are collected from the same cached health reader. `bus_consumer_lag` and
  `bus_pending_entries` expose only the fixed `engine`/`executor` groups. Missing
  streams/groups or unknown lag produce no count series, not invented zeroes.
  Failed samples clear old stream values. These are not independent Redis/DB exporters.

## Dashboards and Rules

Three file-provisioned dashboards are available in Grafana's Meridian folder:
Operations (15 panels), Trading and Risk (ten), and PnL and Drawdown (three).
All use the stable `meridian-prometheus` datasource.
Operations covers ingest, storage, bus lag and process/API health; Trading and Risk
covers runtime loop telemetry and the existing Executor kill/rejection metrics.
Engine/Executor remain intentionally stopped in local viewer setup, so they show
unavailable/no telemetry. Unknown financial values remain absent, not invented zeroes.

`infra/prometheus/rules/meridian.yml` contains fourteen evaluated rules: scraper down,
not-ready service, unavailable storage, stale/unobserved feed, reconnect burst,
consumer lag/pending, ingest backlog, informational kill engagement, API rate
limiting, stale storage sample, unavailable backtest dispatcher, recent Binance
418/429 responses, validated drawdown reaching the effective executor limit and
repeated risk rejections above a provisional threshold.
Operational thresholds are provisional, not effective trading
risk limits. Reconnect burst uses the cumulative counter's five-minute increase, including
process-reset handling. API HTTP 429 is not a Binance 429 signal.
Telegram delivery is configured through local Alertmanager; see setup below.
The drawdown rule uses the actual configured breaker limit and a fresh risk sample.
Weight utilization alerts remain pending because no authoritative quota is exported.
Stopped services intentionally produce scraper-down alerts; do not start them to
silence alerts. Retired targets may remain queryable briefly after config changes;
verification checks current active targets, not all historical `up` samples.

Rule fixtures are in `infra/prometheus/tests/meridian.yml` and `telemetry.yml`, runnable
with `promtool test rules`. They exercise all fourteen firing rules and stale,
expired-throttle, lag and kill non-firing
boundaries. No actual failure/trading injection is used. The Compose volume mounts
rules read-only. Recreate/reload only observability containers when updating mounts;
do not restart shared Redis/database as part of dashboard provisioning.

Remaining full TRD instrumentation and production-scale telemetry acceptance,
OpenTelemetry/Sentry, containers, chaos/throughput proof, backups and deployment
are still pending. Earlier long-run trading and ingest gates remain unchanged.

## Financial, Exchange And Worker Telemetry

`pnl_realized` / `pnl_unrealized` come from the shared portfolio reader's existing
persisted-fill accounting, labeled by environment, quote asset and scope. Existing
API/SSE reads refresh samples; no extra exchange polling is introduced. Unknown,
stale or failed reads clear the relevant series. Wallet equity is not allocated PnL.

Executor `drawdown_pct` and `meridian_drawdown_limit_pct` are percentages, not
fractions. Equity and UTC-day realized risk PnL are published only after existing
risk validation, with the actual allocation/full-wallet scope. They require a running
Executor; no trading runtime was started for local verification.

API and Executor REST clients export bounded environment/status labels, transport
failures, response-header latency and observed `x-mbx-used-weight-1m`. This is
one-minute IP usage, not API-key quota or percentage utilization; see the
[official Binance REST documentation](https://developers.binance.com/en/docs/products/spot/rest-api).
URLs, queries, credentials and bodies never become metric labels. Missing/invalid
weight headers remove old samples. A timestamp captures actual 418/429 responses,
including a first response before a counter baseline scrape.

`order_submit_latency_ms` measures the existing query-before-retry submit operation,
not exchange fill latency. A resolved operation can recover an existing order; it
does not prove a newly placed or filled order.

The API samples committed ledger state at most once per 30 seconds, coalescing
concurrent reads. `orders_total{status}` is a **gauge of current persisted state
populations**, not a lifecycle-transition counter; never use `rate()` on it.
`meridian_backtest_jobs_by_state` reports actual queued/running/succeeded/failed
database rows, not inferred process results. Counts scan durable history and need
production-size performance/retention acceptance. Failed, invalid or late samples
clear series; dashboard queries require fresh timestamps and successful scrapes.

`order_fill_latency_ms{quantile}` exposes p50/p95/p99 over the latest 1,000
persisted execution rows, using exchange event time minus local order creation.
This includes partial executions, waiting/recovery and clock skew, not just final
fills or network latency. Negative samples are excluded; zero fills produce no
latency series. Primary-key deduplication prevents replayed fills inflating samples.
Engine `strategy_signal_latency_ms` is a local processing-through-successful-publish
histogram, not end-to-end exchange latency. No per-order/strategy identifiers are labels.
Receipt-to-bus timing and process-lifetime reconnect counters are implemented. Cross-process
history is retained by Prometheus, not a Redis-persisted application counter. Full service/
production performance coverage remains open.

Viewer-authenticated `GET /api/system/backtest-worker` is read-only/no-store and
reports recent successful dispatcher ticks and active local children (0 or 1).
Process exit zero does not prove durable job success; child count is not queue length.
Dispatcher readiness is distinct from API readiness and becomes unavailable after
dependency failure or stale ticks.

## Telegram Delivery

Set `TELEGRAM_BOT_TOKEN` in ignored `.env` (`MERIDO_BOT_TOKEN` is supported).
Send `/start` privately to the bot. Setup selects only one distinct private start
destination; multiple destinations require explicit `TELEGRAM_CHAT_ID`. It does
not consume/acknowledge updates or accept inbound trading commands. A previously
configured destination is reused for the same token; changed tokens may need a
new `/start` or explicit ID.

```powershell
node --env-file=.env scripts/setup-telegram-alerts.cjs
docker compose -f infra/docker-compose.yml --profile alerts up -d --no-deps alertmanager
docker kill --signal HUP infra-prometheus-1
node scripts/verify-telegram-alerts.cjs
```

Setup writes a secret-bearing generated config only to ignored
`infra/alertmanager/.local/alertmanager.yml`, outside logs and tracked files. Do
not upload that directory or paste Alertmanager's configuration/status responses.
It is a read-only container mount, not a production secret-store implementation.
On non-Windows hosts explicitly grant only the container user access to this file.
Rotate the bot token through BotFather and rerun setup/reload after suspected exposure.

Alertmanager v0.28.1 is opt-in through Compose's `alerts` profile, loopback port
9093, with persistent deduplication state. Alerts group for 10 seconds, update at
one-minute intervals, repeat at most every four hours and send resolved messages.
Default local routing keeps intentionally inactive `meridian-engine` and
`meridian-executor` alerts in Alertmanager without Telegram delivery. Set
`TELEGRAM_TRADING_ALERTS=true`, regenerate and reload before expecting those services
to run; otherwise their real outages/risk alerts would also be suppressed. This
does not clear or silence the underlying Prometheus rules.

The bounded verification injects only its own synthetic Alertmanager alert and
resolves it; it changes no trading/real-alert state. Successful Telegram notification
counters establish API acceptance, not human receipt/read confirmation. Evidence:
`logs/verification/phase-5/telegram.json`. Group/routing/unit and firing/resolved
live checks pass locally. Telegram is best-effort: network, bot blocking, stopped
Docker/Prometheus/Alertmanager or a sleeping laptop can prevent timely delivery.
Remote watchdog/failover is not implemented.

References: [Alertmanager configuration](https://prometheus.io/docs/alerting/latest/configuration/)
and [Telegram Bot API](https://core.telegram.org/bots/api).

## Isolated Shutdown And Chaos Acceptance

`node scripts/verify-chaos.cjs` bundles the production diagnostics/shutdown guard,
order repository and kill-switch implementation into a credential-free runtime
fixture. It creates labeled disposable Redis 7, TimescaleDB/PostgreSQL 16 and Node 22 Alpine
containers on an internal Docker network. No ports are published; probes run
inside the fixture. Only the generated bundle directory is mounted read-only,
never `.env`, trading credentials, the checkout or project data volumes.

Local verification (2026-10-11) passes seven grouped scenarios:

- Actual API/backtest/legacy-ingestor startup and backtest job subprocesses receive Linux
  SIGTERM during controlled database waits, cancel and exit nonzero with bounded cleanup.
- Duplicate execution persistence creates one fill; an older timestamp cannot regress FILLED.
- Redis network disconnect makes readiness unavailable and engages durable PostgreSQL kill state.
- Redis kill/restart remains fail-closed; restored connectivity does not reset kill state.
- Safety fixture crash/restart preserves durable kill state, with no exchange client.
- Actual Linux SIGTERM drops readiness, drains dependencies and exits zero.
- Deliberately hung cleanup exits one on the two-second fixture deadline; observed
  final signal-to-container-exit polling was 3,002ms, including Docker command overhead.

Ownership labels are checked before cleanup. Successful evidence is written only
after fixture containers, anonymous volumes and the network have been removed:
`logs/verification/phase-5/chaos/result.json`. `failure.json` from earlier harness
setup failures is not acceptance evidence. This is real isolated Redis/Postgres
failure injection against production components, not full deployed API/Engine/
Executor E2E, arbitrary reorder coverage, real exchange cancellation or a long soak.
No shared storage or trading process was stopped. Public feed was separately refreshed
to load the new metrics; Windows task termination is not evidence of graceful SIGTERM.
Engine/Executor startup cancellation is tested with mocked clients and zero storage/trading
calls; deployed trading/exchange fault acceptance remains open.

## Ingestion Benchmark

See [benchmark method and results](benchmark.md). The bounded local k6 fixture runs
the production normalization, protobuf publisher, metrics and Timescale writer against
disposable storage. Receipt-to-bus and DB-inclusive operation timing are separate.
This baseline does not meet the TRD <10ms bus target and does not establish 2k+ capacity.
