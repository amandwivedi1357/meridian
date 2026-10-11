# Phase 4 API Gateway

Implemented and locally verified on 2026-10-10. This is backend progress, not
full Phase 4 acceptance. Phase 4.1 backend acceptance is complete. Browser auth/SSE integration remains Phase 4.2; the
current UI still polls. Durable simulation-only backtest job submission/status is implemented.

## Start

Docker Redis and Timescale must be available and repository migrations applied.
The API loads the ignored repository-root `.env` for both compiled and dev runs.

```powershell
node node_modules/typescript/bin/tsc -p packages/db/tsconfig.json
node node_modules/typescript/bin/tsc -p apps/backtest-worker/tsconfig.json
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json
node apps/api/dist/migrate.js
node apps/api/dist/main.js
# Alternatively, hot reload:
pnpm --filter @meridian/api dev
```

Workspace dependencies must be installed/built first (`pnpm build` on a fresh checkout).
The migration command loads `.env`, applies repository migrations transactionally,
and never starts ingestion or trading. API startup requires migration 008.
Hot reload also launches the compiled simulation worker; rebuild API/worker after
changing worker code. No trading API keys are needed for backtests.

## Backtest Jobs

- `POST /api/backtests/jobs` requires an operator session or credential; cookie
  requests require an allowed Origin. Body: `{ "requestId": "<uuid>",
"from": "2024-01-01", "to": "2024-01-02", "strategy": "ema",
"symbol": "BTCUSDT", "interval": "15m" }`. Strategy/symbol/interval have
  these defaults; `1h` is the other supported interval. UTC date range is
  exclusive-end, in the past, increasing and at most 30 days. Unsupported
  strategy/symbol/interval or extra fields return 400.
- Returns 202 `{ "job": ... }`. Same actor/requestId/payload retries return
  the same persisted job; different payload reuse returns 409
  `idempotency_conflict`. Enqueue and audit insertion are one transaction.
- `GET /api/backtests/jobs/:jobId` allows viewers and returns job request,
  state, UTC timestamps, nullable runId/summary/error. Poll until
  `succeeded` or `failed`; missing jobs return 404. Success links to existing
  saved-run detail/fills/equity endpoints through runId.
- PostgreSQL retains the queue across API restart. At most 20 queued/running
  jobs and one running job across API instances; submission is limited to
  10/minute. Capacity returns 503; unavailable persistence fails closed.
- Separate Node subprocess uses the existing EMA replay/sim broker, a
  256 MiB JS heap ceiling and 60-second execution timeout. Only database
  configuration (not Binance/API credentials) is inherited. No exchange
  orders, network candle downloads or live engine/executor launches occur.
- Stored closed candle history must cover every aligned bar in the range;
  otherwise the job fails `market_history_incomplete`. Results and success
  status publish atomically after a lease/token ownership check. Claim leases
  last 30 seconds and renew while the API is healthy. Stale running jobs fail
  `worker_lost`; interrupted jobs are not automatically replayed. Graceful
  shutdown fails its active job `api_shutdown`; timeout is `worker_timeout`;
  other worker/publication failures are sanitized `worker_failed`.
- Queued jobs resume automatically; failed jobs need a new requestId for an
  explicit retry. Terminal job/result retention and browser submission UI
  are not implemented. Existing prototype EMA sizing/fees/slippage remain
  fixed in the backtest worker; this is not a strategy optimizer.

Verification: 899 tests across 82 files pass, including 22 job/contract checks
using isolated PostgreSQL/Redis namespaces, actual EMA replay with nonzero
simulated fills, compiled worker execution, concurrent claims, publication
fencing/rollback, durable retries, capacity and timeout/shutdown. Migration 008
is applied locally; API readiness and existing read routes pass. Local auth
remains viewer-only, so shared job submission is intentionally forbidden until
operator credentials are explicitly configured.

Default bind: `127.0.0.1:3000`. Vite on `127.0.0.1:5173` proxies `/api` here.
`/health/live` is process liveness; `/health/ready` checks Redis readiness and a
real database query, returning 503 on failure. Neither endpoint is authenticated.
Rate-limit Redis must connect before startup; it does not fall back to a local
in-memory limiter. Graceful shutdown closes SSE clients, Redis and PostgreSQL.

## Authentication

Without `API_VIEWER_TOKEN`/`API_OPERATOR_TOKEN`, development is read-only viewer
mode; login is unavailable and operator writes remain forbidden. It is not an
operator bypass. Existing API-key headers remain compatible: `Authorization:
Bearer <credential>` or `X-Meridian-API-Token`. These are dashboard credentials,
not Binance trading keys.

Authenticated mode requires distinct private credentials of at least 32
characters and a private `JWT_SECRET` of at least 32 characters (the example
placeholder is rejected). Store these only in ignored `.env` or a secret store.
Do not print them in chat, pass them as CLI arguments, or commit them.

- `POST /api/auth/login`: strict JSON `{ "token": "<viewer-or-operator-credential>" }`.
  Exchanges a configured credential for an HS256 JWT valid for 15 minutes.
  Issuer/audience/algorithm/expiry and role are validated. The server chooses the
  role, never a request-supplied role. Returns role/expiry, not the JWT in JSON.
- Cookie: `meridian_session`, HttpOnly, SameSite=Strict, Path=/api; Secure in
  production. This supports native EventSource without tokens in URLs/storage.
- `GET /api/auth/me`: current principal and session expiry when applicable.
- `POST /api/auth/logout`: clears the browser cookie. Previously copied JWTs
  still expire naturally; there is no server-side revocation/refresh-token store.
- Cookie-authenticated writes require an Origin in `API_ALLOWED_ORIGINS`.
  Login rejects an explicitly disallowed Origin. Non-browser API-key/bearer
  clients can continue using headers without a browser Origin.
- Production refuses anonymous viewer mode, weak secrets and missing/non-HTTPS
  allowed origins. Deployment still needs HTTPS termination and reviewed network
  access; the process itself intentionally binds loopback.

Rate limiting uses `@fastify/rate-limit` with a dedicated ioredis connection:
300 requests/minute per IP by default and 5 login attempts/minute. Redis stores
the counters across API instances/restarts; forwarded-IP headers are not trusted.
Exceeding returns 429 plus Retry-After. Store failures do not authorize a bypass.
Credential/cookie headers are redacted from request logging.

## REST And OpenAPI

Existing market/order/fill/risk/strategy/control routes remain at `/api/*`.
Zod validates query/body/strategy parameters at the gateway; new session,
backtest and stream routes use the Zod type provider. Generated specification:
`GET /api/openapi.json`, protected like other API reads in authenticated mode.
Existing response schemas still need richer typed contracts; documentation is
not a guarantee that every earlier DTO is fully runtime-validated.

Saved backtest reads are now available:

- `GET /api/backtests?limit=20` (maximum 100).
- `GET /api/backtests/:runId` (metadata/parameters/metrics; missing run is 404).
- `GET /api/backtests/:runId/fills?after=-1&limit=200`.
- `GET /api/backtests/:runId/equity?after=-1&limit=200`.

History pages use index cursors, maximum 1,000 items/page and `nextCursor`.
Monetary quantities/prices/fees/equity remain decimal strings. Empty history is
not invented data. The API does not launch backtests or trading processes yet.

## SSE Contract

- `GET /api/stream/market?symbol=BTCUSDT&interval=15m`.
- `GET /api/stream/account`.

Authentication is identical to REST; browser clients use the HttpOnly session.
No token query parameter is accepted. Headers disable caching/proxy buffering;
retry hint is 2 seconds and heartbeat comments occur every 15 seconds. JWT expiry
closes the connection; re-login is required rather than an indefinite session.

`ready` carries an initial checkpoint. `market`/`account` events have an `id`
and JSON `{ "events": [...] }`. Market payloads decode both actual Redis Protobuf
and legacy JSON while preserving decimal values as strings. Reads use XRANGE,
not consumer groups, so dashboard clients do not steal events/ACK engine work.
Market batches occur at most 4 Hz per client, 100 entries/source per batch;
contiguous book deltas merge by price with zero-quantity deletions preserved.
Gaps (including across batches) require resync, not a fabricated book snapshot.
Market batches are grouped by source, not a total chronological merge.

Account events are complete **bounded recent-state snapshots**, not an exhaustive
execution-event history or live PnL valuation. They share REST trading DTOs for
orders, fills, risk events, kill state and strategies, with `historyLimit:100`.
DB reads use a repeatable-read, read-only transaction; account sampling is shared
within an API instance at 250ms intervals. Changed snapshots are deduplicated and
persisted atomically in a Redis stream with exactly at most 128 retained entries.
Transient states between samples are not guaranteed to appear; durable fill/order
history remains in PostgreSQL and REST. There is no invented equity/PnL field.

Reconnect with `Last-Event-ID` (the versioned checkpoint returned by SSE). Market
checkpoints bind symbol/interval and the three native Redis source IDs; account
checkpoints bind the persisted snapshot ID. Redis-backed replay survives API
restart. Invalid, mismatched or trimmed checkpoints return 409 `resync_required`.
Failures/gaps after headers emit `resync` and close; clients must bootstrap REST
state and reconnect without the stale checkpoint. Initial market connections
start at current stream tails. Bootstrap with `GET /api/market/snapshot?symbol=BTCUSDT&interval=15m`
and pass its `cursor` to `/api/stream/market?symbol=BTCUSDT&interval=15m&cursor=...`.
The query cursor supports native EventSource; a reconnect `Last-Event-ID` header takes precedence.
Snapshot captures Redis checkpoints before fetching public Binance depth, then uses the
existing depth-sync engine to bridge exchange update IDs. The configured production gateway
seeds chart history from 200 recent closed public Binance candles using the same market
environment as depth, then merges live candle updates; arbitrary old DB history is not mixed
into this display bootstrap. History is validated for alignment, continuity, recency and OHLC,
coalesced/cached for 30 seconds across at most four topics and refreshed at interval boundaries.
History failures return 503, not fabricated data. This does not persist candles or fill DB gaps
for backtests; `/api/market/candles` still reads persisted history. Snapshot also returns
up to 200 recent trades, a limited-depth book and the matching replay cursor. Decimal values
stay strings. The book starts with at most 100 levels per side (`complete:false`), not the
entire exchange book. Missing/stale depth feed, trimmed checkpoints, sequence gaps or a
missing bridge return 503; clients must retry bootstrap rather than display fake depth.
`MARKET_DATA_ENV` defaults to `production` and must match the ingestor's environment;
it is separate from trading `BINANCE_ENV`. Do not mix environments in the same Redis streams.
Concurrent bootstrap requests for the same topic share work; at most four topics load at once.
Real-feed bootstrap/SSE handoff and header resume passed a bounded public BTCUSDT
ingest check. UI bootstrap/SSE and chart controls are now wired (4.2 checkpoint). The check stops its feed after
verification; snapshot returns 503 again when the retained book becomes stale.

Connections are capped at 600 per API instance and each response buffer at 256
KiB; slow clients stop reads while backpressured and oversized batches close.
Disconnect/shutdown clears timers and sockets. Market polling currently reads
Redis per client; a shared market fan-out reader may be needed before the planned
500-client k6 load gate. That gate and sub-second browser latency are not claimed.

## REST Contracts and Controls

The gateway applies runtime Zod response contracts to JSON REST market history,
snapshot, dashboard, orders/fills, trading/risk state, strategies, positions/account,
saved-backtest reads and auth sessions. OpenAPI includes success and error shapes.
Arbitrary stored JSON details/metrics remain JSON objects rather than invented domain
fields. Decimal-backed market objects normalize to strings, and PostgreSQL run dates
normalize to ISO strings. Invalid output fails with a sanitized 500; schema diagnostics
and private DTO contents are not returned. SSE uses its separate framed transport
contract, not the JSON serializer. Strategy listing is bounded to 100 entries.

Control API acceptance uses a unique PostgreSQL schema, unique Redis limiter keys and
an adapter that redirects the test kill flag to a test-owned Redis key. JWT cookie
viewer/operator authorization, allowed origin and resume confirmation are exercised.
State, audit actor/reason and risk-event insertion are atomic. Injected audit/event
failure rolls back the state; Redis is updated only after the durable kill commit.
Redis failure returns `redisUpdated:false` while the database remains engaged.
Resume never clears the global kill switch. This proves API persistence/authorization,
not live exchange cancellations or browser controls. Shared control state is untouched.

Earlier contracts/controls verification: 451 tests across 50 files passed.
Latest Phase 4.1 backend verification: 989 tests across 111 files pass (including
ingestor, replay, DB, accounting and REST regressions); builds/lint/UI typecheck pass.
Frontend SSE/auth/controls and live rendering are Phase 4.2.

## Fee-Aware Portfolio

`GET /api/account/portfolio` has a typed response contract. `/api/positions` and
`/api/account/summary` use the same reader; account SSE includes it as `portfolio`.
Scope is explicitly `persisted-fills`, not the entire wallet. Chronological fills
use weighted-average inventory/cost accounting shared with Testnet allocation.
Base BUY fees reduce received inventory; base SELL fees remove extra inventory/cost.
Quote BUY fees increase basis; quote SELL fees reduce proceeds. Realized PnL is
all-time over retained fills, not the risk engine's daily/strategy PnL. Gross buy/sell
totals remain informational; `quantity` is fee-adjusted. Amounts are decimal strings.

Metadata and fresh midpoint marks come from public Binance endpoints using
`BINANCE_ENV`, not `MARKET_DATA_ENV`, so Testnet fills are not marked with production
prices. Flat positions need no price. Nonzero positions require a valid mark no
older than 15 seconds. Missing opening basis, third-asset historical fee conversion,
unknown metadata and missing/stale marks produce explicit unavailable/null fields.
Totals are grouped by quote asset and withheld where inputs are incomplete.
`equity` now comes from the separately scoped `wallet` snapshot when fully
priceable; `equityScope: exchange-wallet` and `wallet.quoteAsset: USDT` identify
its units. It is not computed by adding fill PnL to an invented initial balance.
No allocation is activated and trading risk logic is unchanged.

## Read-Only Wallet

The API uses existing Testnet signing/time-sync code solely for balance reads;
no order method or user-data subscription is invoked. Configured Testnet
credentials are required; missing/invalid credentials or unsupported production
wallet mode return an explicit unavailable wallet rather than a public-data guess.
`wallet` is included in portfolio, positions, summary and account SSE. It reports
free, locked and total balances, current USDT values, tracked base quantity,
observed difference and reconciliation reasons. Cash USDT is valued at one;
other assets use actual bid/ask midpoints on trading pairs from the same
environment. Direct/inverse pairs or at most two hops through BTC/USDC/ETH/BNB
are supported; stablecoins are not assumed to be at parity. Halted, zero-bid,
crossed or missing quotes are unusable. Quote API weight/reference:
[Binance official Spot connector](https://binance.github.io/binance-connector-js/classes/_binance_spot.SpotRestAPI.MarketApi.html).

All nonzero holdings remain visible. If any cannot be valued, equity is null
with `unpriceable_wallet_assets`, never a partial total. Snapshot loads are
coalesced/cached for ten seconds and observations older than 15 seconds are
unavailable; failed refresh never reuses stale success. At most 1,000 holdings
and 10,000 pairs are processed, and capacity failure is explicit. Account SSE
payloads are capped at 240 KiB within the existing 256 KiB transport limit.
Account history is capped at 128 snapshots (at most 30 MiB payload, excluding
Redis overhead), rather than retaining 1,000 potentially large wallet snapshots.
Trimmed account cursors require a REST resync; durable orders/fills are unaffected.

Quantity reconciliation compares wallet total with summed persisted-fill base
inventory. Positive differences report `opening_or_external_inventory`,
negative ones `ledger_exceeds_wallet`; unknown ledger inputs report
`ledger_inventory_unavailable`. This is an observed comparison, not a persisted
opening-cost baseline, automatic ledger repair or an atomic exchange/DB snapshot.
Entry cost and whole-wallet PnL for opening/external holdings remain unknown until
an explicit audited cost-basis input exists. Third-asset historical fee conversion
is also still unsupported. Neither is substituted with today's price.

Repeatable bounded verification (API/infra must already be running):

```powershell
node apps/api/dist/verification/wallet-check.js
node apps/ingestor/dist/smoke/market-bootstrap-check.js
```

The second command subscribes to production **public** BTCUSDT trades, 15m
klines and depth, persists through the real ingestor and checks API bootstrap plus
SSE book continuity on initial cursor and header resume. It is bounded to 60
seconds, closes its feed/clients, and starts no engine/executor or trading.
It requires `MARKET_DATA_ENV=production` and must not run alongside a Testnet
market producer writing the same streams. Evidence (counts only, no keys or
individual wallet balances): `logs/verification/phase-4-1-wallet.json` and
`logs/verification/phase-4-1-market-bootstrap.json`. Real checks passed on
2026-10-10: 517 Testnet assets with three unpriceable, wallet SSE delivered,
kill engaged/orders unchanged; synchronized book and both SSE handoffs passed.

Replay is bounded to 10,000 fills and five symbols; exceeding either returns 503,
never a truncated ledger. Concurrent readers share work with a two-second cache.
Portfolio observations have their own timestamps and are separate from the account
state repeatable-read transaction. Neither implies a joint exchange/DB atomic snapshot.
API/Binance REST/core/allocated-engine/risk regression verification: 441 tests pass
across 48 files, including real isolated PostgreSQL fills into account SSE. Public
Testnet metadata and BTCUSDT depth reads also passed without keys/orders. Shared app
ledger remains empty; UI metrics/positions still require 4.2 wiring.

## Local Dashboard Login and First Saved Simulation

Local login is now configured (2026-10-11). Dashboard credentials are independent
of Binance exchange keys. Use `API_OPERATOR_TOKEN` from the ignored `.env` in
Sign in to submit simulations, or `API_VIEWER_TOKEN` for read-only access.
Both `http://localhost:5173` and `http://127.0.0.1:5173` are allowed local origins.
Sessions expire after 15 minutes. No credential is stored in browser storage or
printed by the setup/verification scripts.

```powershell
node scripts/setup-dashboard-auth.cjs
# Restart the API after changing its configuration.
node --env-file=.env apps/ingestor/dist/main.js backfill-klines --symbol BTCUSDT --interval 15m --start 2026-10-09 --end 2026-10-10 --limit 1000
```

The first actual browser-submitted local simulation for that UTC day succeeded:
96 persisted closed candles, 96 saved equity points, zero simulated fills and
zero strategy return/drawdown. Its saved run is
`job:832ec502-e5d2-441e-8ad4-cf1f60c57d2c`. Desktop/mobile results, viewer write
denial and live authenticated viewer SSE are verified. Exact shared orders and
fills remain zero, kill remains engaged, and no trading services were started.
Evidence: `logs/verification/phase-4-2/backtest-live-report.json`.
Only that date range/15m history was explicitly backfilled here; other dates or
1h simulations still require their own complete stored candle history.

`apps/web/scripts/verify-live-backtest.cjs` verifies this saved result without
submitting a new job by default. Explicit `--submit` launches a new local
simulation for the documented range; it never places exchange orders. Set
`PLAYWRIGHT_MODULE` to the installed Playwright module when needed.

## System Health Telemetry

Authenticated viewer/operator `GET /api/system/health` is a read-only dependency
observation, not a trading readiness authorization. It returns `checkedAt`,
Redis/database availability and seven fixed topics (BTCUSDT trade/book/four
candle intervals plus signals). Stream rows report availability, retained length
and Redis group name, registered consumers, pending acknowledgements and
undelivered `lag`. Null or unsupported lag stays null; missing/no-group is not
reported as zero backlog. Consumer registration does not prove process liveness,
and retained stream length is not consumer lag. No global key scan is used.

Probes use a bounded Redis client (two-second connection/command timeouts) and
the existing bounded DB pool. Results are coalesced and cached for five seconds
across clients. REST uses runtime JSON/OpenAPI validation and no-store caching.
The browser performs one health bootstrap per live connection cycle, then
receives `event: health` through the existing account SSE roughly every five
seconds. Both SSE channels send a visible `event: heartbeat` every 15 seconds.
Neither event has its own `id`, so it cannot advance market/account replay
checkpoints. Health failure does not itself disrupt account event delivery.

UI receipt ages use the browser clock; market data age uses actual exchange
event time. Dependency observations older than 15 seconds are unknown/stale;
SSE receipt ages beyond 45 seconds are flagged. Browser recovery counts reset
with the connection cycle (login/timeframe); they are not Binance reconnect
counters. Detailed upstream telemetry and running-service heartbeats remain
Phase 5 work. The paused soak and 48-hour trading gate are unchanged.

Real browser health advancement/no healthy REST polling and desktop/mobile
screenshots pass. A uniquely namespaced real Redis group test verifies one
pending message and one undelivered message independently, deleting only its
own test key. Broad regression: 1035 tests pass, plus this integration test.

## Isolated Browser Control Verification

```powershell
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json
$env:API_TEST_DATABASE_URL='postgres://meridian:meridian@127.0.0.1:5432/meridian'
$env:API_TEST_REDIS_URL='redis://127.0.0.1:6379'
# Set PLAYWRIGHT_MODULE to the installed Playwright module if not on the module path.
node apps/web/scripts/verify-controls.cjs
```

This script uses an ephemeral API port and a separate available Vite port starting
at 5180, preserving the normal dashboard. Credentials exist only in test memory.
It creates a UUID-scoped schema/Redis prefix, uses real JWT cookies and account
SSE, and applies controls only to fixture data. Public market bootstrap is
synthetic; no exchange connection, order, engine or executor is involved.
Viewer denial, pause/resume/kill confirmation and cancel, audit rollback,
expired-cookie 401 and frontend expiry timer are exercised in Chrome. Three
successful fixture actions produce three audited risk events. Shared DB safety
state and Redis kill flag are checked unchanged, then owned fixtures are cleaned
up. Output: `logs/verification/phase-4-2/controls-isolated.json` and screenshot.

This test discovered that discarding account `checkedAt` caused control updates
to inherit older cached portfolio time and be rejected by the frontend's replay
guard. Account SSE now retains the transaction observation timestamp separately
from portfolio timestamps. Both sampling timestamps are excluded from the
deduplication fingerprint; old replay cannot roll state backward and unchanged
snapshots do not generate periodic events. Real Redis regression covers this.
Verification: 1037 tests across 119 files pass; restart/latency/load gates remain
separate and incomplete.

## Earlier Verification (Historical Results)

Market bootstrap verification 2026-10-10: API and Binance REST suites pass 294 tests
across 34 files, including six isolated infrastructure cases. Coverage includes snapshot
ordering, sequence bridging/gaps, deletes/decimal precision, stale-feed rejection, cursor
handoff/header precedence and HTTP timeout behavior. API/Binance builds and lint pass;
UI typecheck passes. No live ingestion or trading was started for this verification.

63 tests across 17 API files pass, including loopback SSE transport and five
opt-in real Redis/PostgreSQL cases for source replay after restart, account
snapshot persistence, protected OpenAPI and login throttling. They also prove
global rate counters survive API-instance restart and book gaps are detected
between batches. Tests use unique
schemas/key prefixes; they do not place orders or mutate application tables.

```powershell
$env:API_TEST_DATABASE_URL='postgres://meridian:meridian@127.0.0.1:5432/meridian'
$env:API_TEST_REDIS_URL='redis://127.0.0.1:6379'
node node_modules/vitest/vitest.mjs run apps/api
```

Live local smoke: UI-proxied auth status, saved-backtest reads, OpenAPI, trading
state and account SSE responded successfully. Current session was local viewer,
kill switch engaged. Market ingestor/executor were not started; live market feed,
UI login/actions, 500-client load and browser SSE reconnect are still unverified.
