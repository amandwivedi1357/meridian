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
Read docs/current-state.md and docs/implementation-plan.md, then continue from Phase 1.4. I will write implementation code; you guide me and write/update tests.
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

Phase 1.4: Ingestor service.

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
    - exposes `MarketEventMessage`, `encodeMarketEvent`, and `decodeMarketEvent`
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
    - wires shared codec, publisher, and batch writer behind `createMarketIngestor`
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

## Current Verification Baseline

Latest verified package checks:

- `@meridian/binance-client`
  - Typecheck passed.
  - Tests passed: 35 tests across 10 test files.
- `@meridian/proto`
  - Typecheck passed.
  - Tests passed: 3 tests across 1 test file.
- `@meridian/ingestor`
  - Typecheck passed.
  - Tests passed: 44 tests across 20 test files.
- `@meridian/db`
  - Typecheck passed.
  - Tests passed: 9 tests across 3 test files.

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
```

## Next Work

Continue Phase 1.4. The core unit-tested ingestor pipeline pieces exist. Next work should focus on live infrastructure wiring and persistence completeness:

- decide whether to replace the current JSON-bytes codec with generated protobuf/buf now or keep the tested codec boundary until later
- add actual runtime clients/dependencies in `main.ts` for Redis, Postgres, Binance REST, and startup/backfill command dispatch
- smoke test migrations/backfill against local Docker TimescaleDB
- smoke test market event publishing against local Docker Redis
- later: continuous aggregates/compression and `packages/bus` consumer/ack helpers

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
