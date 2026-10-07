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

Suggested first message when resuming in a new chat:

```txt
Read docs/current-state.md and docs/implementation-plan.md, then continue from Phase 3.2 order lifecycle. Phase 3.1 is complete: authenticated Testnet client code, shared ExchangeGateway / MarketDataSource contracts, Binance/simulator adapters, read-only Testnet auth smoke, and live Testnet place/query/cancel smoke are verified. The soak monitor is paused; do not restart it automatically. I will write implementation code unless I explicitly ask you to implement; you guide me and write/update tests.
```

Before continuing feature work, verify the baseline:

```powershell
pnpm --filter @meridian/binance-client typecheck
pnpm --filter @meridian/binance-client test
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

Review fixes verified on 2026-10-07: simulator submissions carry explicit client order IDs through pending orders into fills; gateway snapshots update by identity and completed orders remain queryable. Duplicate IDs and untagged/mismatched fills fail closed. Partial fills preserve `PENDING_CANCEL` until the cancellation outcome arrives. Binance order serialization uses fixed-point decimal strings. Write-ahead persistence now checks immutable order details atomically on client-ID conflict and requires the database adapter's `rowCount` result; mismatches throw instead of silently succeeding, while identical retries preserve state/timestamps. PostgreSQL verification used a temporary table and rollback: insert, identical retry, and nine conflicting retries passed. The downstream third-migration expectation and three lint errors are fixed. Affected-package regression baseline: 823 tests across 85 files; build/typecheck and lint pass. No live Testnet orders were placed or canceled for these fixes. Phase 3.2 reconciliation, out-of-order handling, and other remaining checklist items are still open.

Phase 3.1 in progress on 2026-10-06: all P0 client code is implemented: HMAC/Ed25519 signing, synchronized server time, Testnet-only authenticated HTTP, validated order endpoints, and user-data WebSocket subscription with account/execution events, heartbeat, reconnect, and rotation. `createTestnetTradingClient` composes these without starting network requests on construction; signed operations require fresh time. `createTestnetTradingClientFromEnv` loads exactly one signing credential, rejects production, and sanitizes key-loading errors. A read-only `smoke:trading <SYMBOL>` command loads repo-root `.env`, reads open orders, and checks user-data subscription without placing/canceling orders. Binance client: 269 tests across 20 files; build and lint pass, including a real loopback WebSocket integration test. No real Testnet authenticated request or order was sent. Phase 3.1 is NOT complete: its P1 shared gateway/market-data contracts and Binance/simulator adapters, plus real Testnet verification, remain open. Work one subphase at a time as requested: finish 3.1 before starting 3.2 lifecycle/reconciliation/executor work. Reconnect gaps require reconciliation and exchange-metadata preflight is required before unattended execution. See `docs/testnet-client.md`. Phase 1 soak monitoring remains paused; its 24h criterion is open.

Phase 3.1 completed on 2026-10-07: shared `ExchangeGateway` and `MarketDataSource` contracts are exported from `packages/core`. `packages/binance-client` now has a Binance gateway adapter around the authenticated order client and a REST-kline `MarketDataSource`; `apps/backtest-worker` now has a simulator gateway adapter around `SimBroker` and a candle-feed `MarketDataSource` adapter. Verified locally: `@meridian/core` typecheck and 36 tests across 4 files; `@meridian/binance-client` typecheck and 277 tests across 22 files; `@meridian/backtest-worker` typecheck and 361 tests across 25 files. Read-only live Testnet authentication is verified: `pnpm --filter @meridian/binance-client smoke:trading BTCUSDT` returned `openOrderCount: 0`, `userDataState: "OPEN"`, `eventsReceived: 0`, and `ordersPlaced: 0`. Live Testnet order placement/query/cancellation is verified: `pnpm --filter @meridian/binance-client smoke:trading-order -- --symbol BTCUSDT --quantity 0.0002 --confirm-testnet-order` placed a passive LIMIT BUY at `83000.91`, queried it as `NEW`, canceled it as `CANCELED`, and confirmed `stillOpen: false`.

Phase 3.2 started on 2026-10-07: the core order lifecycle state machine is implemented with `PENDING_NEW`, `UNKNOWN`, `PENDING_CANCEL`, terminal states, guarded transition helpers, and exhaustive focused tests. Deterministic Binance-safe `clientOrderId` generation is implemented with prefix validation, SHA-256 base64url hashing, attempt isolation, and focused tests. Write-ahead persistence foundation is implemented in `packages/db`: `orders` schema migration, `PENDING_NEW` insert repository, idempotency uniqueness, and reconciliation indexes. Timeout handling now uses query-before-retry through `createQueryBeforeRetryOrderSubmitter`, which queries by `clientOrderId` after unknown placement outcomes and never blind-resends. Verified: `@meridian/core` typecheck and 80 tests across 6 files; `@meridian/db` typecheck and 16 tests across 4 files; `@meridian/binance-client` typecheck and 281 tests across 23 files. Next Phase 3.2 item is reconciliation on startup/after reconnect.

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
  - Build and lint passed.
  - Tests passed: 283 tests across 23 test files (2026-10-07), including fixed-point gateway serialization regressions.
- `@meridian/proto`
  - Typecheck passed.
  - Build passed.
  - Tests passed: 4 tests across 1 test file.
- `@meridian/ingestor`
  - Typecheck passed.
  - Build passed with dependent packages via `pnpm --filter @meridian/ingestor... build`.
  - Tests passed: 72 tests across 27 test files.
- `@meridian/config`
  - Typecheck passed.
  - Tests passed: 1 test across 1 test file.
- `@meridian/db`
  - Typecheck passed.
  - Tests passed after write-ahead conflict regression fixes: 20 tests across 4 test files. Temporary-table PostgreSQL retry/conflict verification also passed.
- `@meridian/bus`
  - Typecheck passed.
  - Tests passed: 15 tests across 1 test file.
- `@meridian/core`
  - Typecheck passed.
  - Build passed.
  - Tests passed: 84 tests across 6 test files, including partial-fill/cancellation race regressions.
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
