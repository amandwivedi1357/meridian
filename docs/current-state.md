# Meridian Current State

This file is the quick resume point for the project. Use it with `docs/implementation-plan.md` when continuing work in a new chat.

## Working Agreement

- The user writes code unless they explicitly ask Codex to code.
- Codex can update `docs/implementation-plan.md` as phases and features are completed.
- Codex owns CSS when frontend styling begins.
- Codex adds or updates tests when adding behavior.
- When the user says `done`, Codex verifies by inspecting files and running relevant checks before confirming.
- Do not block on tiny formatting issues unless they affect correctness, type safety, security, runtime behavior, or maintainability.
- Explanations should be learning-first and can be in Hinglish.

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

Phase 1.3: Local order book.

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

## Current Verification Baseline

Latest verified package checks for `@meridian/binance-client`:

- Typecheck passed.
- Tests passed: 35 tests across 10 test files.

Run:

```powershell
pnpm --filter @meridian/binance-client typecheck
pnpm --filter @meridian/binance-client test
```

## Next Work

Phase 1.3 core is complete. Next work is Phase 1.4: ingestor service that validates and normalizes market events, publishes to Redis Streams, and writes batches to TimescaleDB.

## Important Notes

- Use `Decimal`, never `parseFloat`, for money and quantities.
- Binance stream payloads are JSON text, not binary.
- Keep functionality small and testable.
- Mark completed plan items in `docs/implementation-plan.md`.
