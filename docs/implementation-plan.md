# Meridian — Implementation Plan

| Field              | Value                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Related docs       | `PRD.md`, `TRD.md`                                                                                                                                                                                                             |
| Estimated duration | ~10–12 weeks part-time in total (revised 2026-10-04 using Phase 1 actuals; adjust to your pace)                                                                                                                                |
| Rule               | **Do not declare a phase done until its exit criteria are met.** Criteria that need wall-clock time (24h soak, 48h paper run) may run in the background while the next phase starts, but must pass before the phase is closed. |

Legend: `[ ]` todo · **P0** must-have · **P1** should-have · **P2** nice-to-have

---

## Timeline at a glance

| Phase | Focus                            | Est.        | Demo you can show after it                     |
| ----- | -------------------------------- | ----------- | ---------------------------------------------- |
| 0     | Foundation & tooling             | 3–4 days    | `docker compose up` works, CI green            |
| 1     | Market data ingestion            | 1–1.5 weeks | Live order book + candles stored in DB         |
| 2     | Strategy SDK & backtester        | 1.5–2 weeks | Backtest report with real metrics              |
| 3     | Execution & risk (Testnet)       | 1.5–2 weeks | Bot paper-trading live with kill switch        |
| 4     | API & dashboard                  | 1–1.5 weeks | Live dashboard in the browser                  |
| 5     | Observability, hardening, deploy | 1 week      | Public URL + Grafana + chaos test results      |
| 6     | MCP / AI layer                   | 3–5 days    | Agent answering questions about your portfolio |
| 7     | Polish & resume packaging        | 3–4 days    | README, diagrams, demo video, resume bullets   |

---

## Status snapshot (2026-10-05)

| Area                       | State                                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phase 0                    | Nearly done. Open: Testnet API keys, `packages/proto` buf setup, final secret scan                                                                                                         |
| Phase 1 (1.1–1.5 P0 items) | Done in code and unit tests except wall-clock verification. Open: continuous aggregates (P1), 24h soak, spot-check vs REST snapshot, 60s network kill, and 6-month backfill exit criterion |
| Phase 2                    | Phase 2.0–2.3 complete except walk-forward reporting. Phase 2.4 persistence + CLI save is started; saved-run listing/report generation remain open                                         |
| Phases 3–7                 | Not started                                                                                                                                                                                |

**Strategy for the rest of the plan:** get a thin vertical slice working end to end (Phase 2.0) before polishing any single layer. Infrastructure that nothing consumes yet (generated Protobuf, continuous aggregates) is deferred until a real consumer needs it.

---

## Phase 0 — Foundation & tooling (3–4 days)

**Goal:** a repo where every later phase can be built, tested, and shipped consistently.

- [x] **P0** Init monorepo: `pnpm` workspaces + Turborepo; folder structure from TRD §3
- [x] **P0** Shared TS config (`strict`, `noUncheckedIndexedAccess`), ESLint, Prettier, `lint-staged` + Husky
- [x] **P0** `packages/config`: `zod`-validated env loader (fail fast)
- [x] **P0** `packages/observability`: `pino` logger with redaction, `prom-client` registry helper
- [x] **P0** `infra/docker-compose.yml`: Redis 7 (AOF on), TimescaleDB, Prometheus, Grafana
- [x] **P0** GitHub Actions: install → typecheck → lint → test → build
- [x] **P0** `gitleaks` pre-commit hook + CI step; `.env.example` committed, `.env` ignored
  - Status: `.env.example`, `.env` ignore rule, `.gitleaks.toml`, CI gitleaks step, and local pre-commit gitleaks scan are done.
- [ ] **P0** Create Binance **Spot Testnet** API keys (Ed25519 preferred); store in `.env`
- [ ] **P1** `packages/proto` with `buf` config (`buf lint`, `buf breaking` in CI)
- [x] **P1** ADR template in `docs/adr/`; write ADR-001 through ADR-008 stubs from TRD §1.1

**Exit criteria**

- [x] `docker compose up` starts infra; `pnpm test` and CI pass on an empty-but-wired repo.
  - Verified locally: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `docker compose -f infra/docker-compose.yml config`.
- [x] No secrets in git history.
  - Verified locally with `gitleaks git --redact`; no leaks found across 7 commits.

---

## Phase 1 — Market data ingestion (1–1.5 weeks)

**Goal:** trustworthy, continuously running market data pipeline.

### 1.1 Binance client (REST, read-only first)

- [x] **P0** Typed client for `exchangeInfo`, `klines`, `depth`, server time
  - Verified with read-only Binance public REST smoke test for `serverTime`, `BTCUSDT` depth, and `BTCUSDT` 1m klines.
- [x] **P0** Rate limiter (token bucket by weight; initialize from `exchangeInfo.rateLimits`; read used-weight headers)
  - Status: initial token-bucket limiter integrated with read-only REST methods using endpoint weights. Dynamic initialization from `exchangeInfo.rateLimits` and response-header adjustment will be expanded when we add header-aware HTTP responses.
- [x] **P0** Retry with exponential backoff + jitter; honor `Retry-After`
  - Status: generic full-jitter retry helper integrated into REST HTTP calls for network errors, 408, 429, 418, and 5xx responses. `Retry-After` header-specific delay handling will be expanded when HTTP response header capture is added.
- [x] **P0** Decimal-safe parsing (strings → `Decimal`, never `parseFloat` for money)
  - Verified parser helpers convert Binance depth and kline decimal strings into `Decimal` domain values with unit tests.
- [x] **P0** Contract tests using saved real responses as fixtures
  - Added server-time, depth, and kline JSON fixtures with tests that validate response shape assumptions and decimal parser behavior.

### 1.2 Stream connection manager

- [x] **P0** State machine (`CONNECTING/OPEN/STALE/BACKOFF`), ping/pong, stale-data detection
  - Implemented state transitions, message gating, stale detection, heartbeat timestamp tracking for ping/pong, and unit tests.
- [x] **P0** Reconnect with backoff + jitter; auto re-subscribe
  - Implemented reconnect scheduling with exponential full jitter, deterministic delay tests, and combined-stream reconnect that rebuilds the subscription URL.
- [x] **P0** Proactive rotation before max connection lifetime (make-before-break)
  - Implemented replacement-socket rotation: open the new socket first, promote it, then close the old socket without triggering reconnect backoff.
- [x] **P1** Subscription chunking for stream-per-connection limits
  - Added `chunkSubscriptions` helper with tests for fixed-size chunks, empty input, and invalid chunk sizes.
- [x] **P0** Metrics: `ws_reconnects_total`, `ws_last_message_age_seconds`
  - Added `registerStreamMetrics` helper backed by `prom-client`, using stream manager getters for reconnect count and last-message age.

### 1.3 Local order book

- [x] **P0** Implement the documented snapshot + diff sync procedure (TRD §4.3)
  - Implemented local book, sequence-aware depth sync, snapshot loading, pre-snapshot event buffering, and buffered event replay.
- [x] **P0** Gap detection → automatic resync
  - Gap detection marks the sync core `NEEDS_RESYNC`; the orchestrator triggers a fresh snapshot load after sequence gaps.
- [x] **P0** Property tests (`fast-check`) against a naive reference implementation
  - Added randomized local order book update tests comparing against a simple Map-based reference model.
- [x] **P0** Metrics: resync count, update lag
  - Added metric-friendly orchestrator getters plus `registerOrderBookMetrics` for `order_book_resyncs_total` and `order_book_update_lag_seconds`.

### 1.4 Ingestor service

- [x] **P0** zod-validate + normalize trade/kline/depth events
  - Added `apps/ingestor/src/market/market-events.ts` with zod validation for Binance trade, kline, and depth payloads; normalizes them into decimal-safe internal events and rejects malformed payloads before publish/write.
- [x] **P0** Protobuf encode → `XADD` to Redis Streams (`market.*`)
  - Added shared market event codec in `@meridian/proto` plus `publishNormalizedMarketEvent`; routes trades, klines, and depth updates to `market.trade.*`, `market.kline.*`, and `market.book.*`. Current codec is a stable JSON-bytes boundary with decimal strings behind `EventCodec`; replacing it with generated protobuf can happen behind the same tests.
- [x] **P0** Batched writes to Timescale (`trades`, `klines`), idempotent upserts
  - Added `writeMarketEventBatch` and `createTimescaleMarketWriter`; trade/kline batches are converted into multi-row SQL `INSERT ... ON CONFLICT` statements with Decimal values serialized as strings. Live DB client and migrations are still pending.
- [x] **P0** Dedup by `(symbol, eventId)`
  - Added in-batch deduplication before DB writes using event kind, symbol, and event id; duplicate trade/kline events are skipped before upsert calls.
- [x] **P0** Historical kline backfill CLI (resumable, rate-limit aware)
  - Added planner, CLI arg parser, command runner, Binance REST fetch adapter, and backfill service composition. The backfill path chunks time ranges into rate-limit-friendly requests, fetches Binance klines, converts them to candles, and upserts kline rows through the Timescale writer. Runtime wiring now creates real Redis, Postgres, Binance REST, metrics, startup migration, live startup, and backfill dispatch dependencies from `apps/ingestor/src/main.ts`. Live long-range smoke/backfill verification remains part of Phase 1 exit criteria.
- [ ] **P1** Continuous aggregates (1m → 5m → 15m → 1h) + compression policy (can be deferred: the backtester can resample 1m candles in code; the dashboard is the first real need)
- [x] **P0** `packages/bus`: publish/consume/ack, `XAUTOCLAIM` for stuck messages (promoted from P1: the engine and executor in Phase 3 cannot run without it; integration-test with Testcontainers Redis)
  - Status: initial injected-client helper API and Redis command adapter are implemented, unit-tested, and smoke-tested against local Docker Redis.

### 1.5 Close-out (do before Phase 2 gets deep)

- [x] **P0** Run migrations against a real TimescaleDB and verify live batched writes end to end (writers are currently unit-tested only)
  - Status: real TimescaleDB migration smoke passes locally, a bounded `BTCUSDT` 1m kline backfill wrote rows successfully, Redis publish smoke wrote a normalized trade event to `market.trade.BTCUSDT`, and bounded live ingest smoke wrote real public `BTCUSDT` trade rows to TimescaleDB. Longer-running soak verification remains an exit criterion.
- [x] **P0** Define an `EventCodec` interface; keep the current JSON-bytes codec as the default implementation so generated Protobuf can be swapped in later (TRD ADR-2)
  - Status: `@meridian/proto` exposes `EventCodec<TMessage>` and `marketEventJsonCodec`; `createMarketIngestor` accepts an injected codec and defaults to the JSON-bytes implementation.
- [x] **P0** Session recorder: write normalized trade/kline/depth events to disk in a replayable format (needed for the parity test in Phase 3; PRD FR-1.9)
  - Status: recorder writes replayable NDJSON with Decimal values serialized as strings and is wired into the normalized ingest flow behind optional runtime config.
- [ ] **P0** Start the **24h soak** now and let it run in the background while Phase 2 begins
  - Status: restarted on 2026-10-05 with `smoke-live-ingest --symbol BTCUSDT --events 5000000 --timeoutMs 86400000 --environment production` and manually stopped the same day before the 24h exit criterion. Stop snapshot: Redis `market.trade.BTCUSDT` length 1,071,912; Timescale `BTCUSDT` trade rows 536,742; session recording `sessions/soak/phase-1-5-events.ndjson` size 121,784,825 bytes. Mark complete only after a future full 24h run finishes cleanly and counts are summarized.

**Exit criteria**

- Ingestor runs **24h** without an unrecovered desync.
- Book state matches a fresh REST snapshot within tolerance when spot-checked.
- Kill the network for 60s → service recovers automatically, metrics show the reconnect.
- Historical backfill of ≥ 6 months of 1m candles for 3 symbols.

**Deliverable:** short terminal/GIF showing live book + reconnect recovery.

---

## Phase 2 — Strategy SDK & backtester (1.5–2 weeks)

**Goal:** trustworthy backtests using the same `Strategy` interface that live trading will use.

### 2.0 Vertical slice first (do this before the rest of Phase 2)

One symbol, one strategy, one number. Build the thinnest path that proves the architecture, then widen it.

- [x] **P0** Kline feed for `BTCUSDT` 1h/15m from Timescale in time order
  - Reader implemented in `apps/backtest-worker/src/feeds/`: lazy 1,000-row timestamp pagination, closed candles only, Decimal mapping. Fifteen tests pass; real Timescale temporary-table smoke returned 1,001 candles across two batches and verified filters/precision. January 2024 backfills are verified: 2,976 15m and 744 1h closed candles in the exclusive-end range, with zero continuity gaps.
- [x] **P0** EMA crossover (fixed size) implementing the real `Strategy` interface
  - Decimal EMA with SMA warm-up and a long-only crossover strategy are implemented. Tests cover signals, position guards, closed/symbol/interval filtering, reset behavior, and invalid settings. Backtest worker baseline: 49 passing tests, type check and lint pass.
- [x] **P0** Minimal sim broker: market fills at next open ± fixed slippage, taker fee
  - Fixed slippage and quote-asset fees, bounded pending-order queue, fee-aware balances/cost basis/PnL, equity marking, next-open eligibility, and atomic batch accounting are implemented. Fill failures halt the broker. Backtest worker baseline: 155 passing tests, build and lint pass.
- [x] **P0** Minimal metrics: total return, max drawdown, trade count
  - Decimal percentage return and peak-based drawdown are implemented; starting capital is included in the drawdown curve. Trade count denotes executed fills in this slice. Twenty metric tests pass; backtest worker baseline is 175 passing tests, type check and lint pass.
- [x] **P0** CLI: `pnpm backtest --strategy ema --symbol BTCUSDT --from … --to …` prints the metrics
  - Executable entry point, Postgres dependency, root script, and strict argument validation are verified. Real January 2024 CLI runs processed 2,976 15m candles / 128 fills and 744 1h candles / 28 fills. Invalid date ranges exit with status 1. Backtest worker baseline: 233 passing tests across 14 files, build and lint pass.
- [x] **P0** Same inputs twice ⇒ identical output (first cut of the determinism test)
  - The historical runner drives the real EMA strategy and simulated broker using candle timestamps. A non-zero-trade fixture repeated twice produces identical serialized fills, equity curves, and metrics including fees/slippage. Two real January 2024 15m root CLI runs also produced identical parsed JSON summaries. Backtest worker baseline: 233 passing tests, build and lint pass.

**Slice exit:** one command, one backtest result you trust. Everything below then hardens and widens it.

**Completed 2026-10-05:** `pnpm backtest --strategy ema --symbol BTCUSDT --from 2024-01-01 --to 2024-02-01` returned -0.112751% total return and 0.144664% maximum drawdown. Settings: EMA 12/26, 0.001 BTC fixed quantity, 10,000 USDT initial equity, 10 bps slippage, 0.1% taker fee. This completes only Phase 2.0; the full Phase 2 and Phase 1 soak remain open.

### 2.1 Core domain (`packages/core`)

- [x] **P0** Types: `Candle`, `Trade`, `BookSnapshot`, `OrderIntent`, `Fill`, `Position`
- [x] **P0** `Strategy` and `StrategyContext` interfaces (TRD §4.7)
- [x] **P0** Decimal helpers + rounding to exchange filters (tick size, step size, min notional)
  - Added shared `@meridian/core` Decimal helpers and `ExchangeFilters` utilities for tick-size price rounding, step-size quantity rounding, exact notional calculation, and min-notional checks. Verified with focused unit tests plus backtest-worker downstream typecheck/tests.
- [x] **P0** Indicators (SMA, EMA, RSI, ATR, Bollinger) with unit tests against known values
  - Added shared `@meridian/core` indicator helpers for SMA, EMA, RSI, ATR, and Bollinger Bands with Decimal-safe calculations and focused known-value tests.
- [x] **P0** Position/PnL accounting (average entry, realized/unrealized) that is **fee-aware** (fees in quote, base, or BNB; position quantity net of base-asset fees)
  - The simulated broker now handles quote-asset fees, base-asset fees that net position quantity, and external fee assets such as BNB through configured fee balances. Average entry, realized PnL, and mark-to-market equity are covered by focused accounting and broker tests. Backtest worker baseline: 242 passing tests across 14 files, type check passes.

### 2.2 Backtest engine

- [x] **P0** Data feed reading klines from Timescale in time order
  - Timescale candle feed reads closed candles by symbol/interval in ascending `open_time` order with timestamp pagination and Decimal mapping. Covered by focused feed tests and the backtest runtime path.
- [x] **P0** Simulated clock; strategies use `ctx.now()` only
  - Backtest runtime drives `ctx.now()` from candle open while processing fills and candle close while delivering closed candles. Runtime tests verify initialization time, fill time, and candle callback time ordering.
- [x] **P0** Sim broker: market + limit fills, taker/maker fees, slippage model
  - Simulated broker now supports market fills at next open with fixed slippage/taker fees and limit fills when candle high/low trades through the limit price with maker fees. Untouched limit orders remain pending across candles, and same-open submissions still cannot fill on that candle. Backtest worker baseline: 260 passing tests across 14 files, type check passes.
- [x] **P0** Apply the same exchange filters as live
  - Simulated market fills can now apply configured exchange filters: BUY prices round up to the tick, SELL prices round down, quantities round down to step size, and orders below quantity/notional limits are rejected before accounting. Backtest worker baseline: 248 passing tests across 14 files, type check passes.
- [x] **P0** Look-ahead guard: only closed candles delivered; orders from candle _N_ fill no earlier than candle _N+1_'s open
  - Runtime rejects open/out-of-range/out-of-order candles; broker queue only releases orders submitted before the candle open, including limit/stop orders, so same-open submissions cannot fill on that candle.
- [x] **P0** Conservative intrabar rule: if a candle could trigger both a favourable and unfavourable event, assume the unfavourable one first; limit orders fill only on trade-through (TRD §4.8)
  - Added `STOP_MARKET` order intents for stop-loss style exits, strict trade-through handling for limit orders, and conservative same-candle ordering that processes stop orders before favourable limit targets. Core tests remain green; backtest worker baseline: 268 passing tests across 14 files, type check passes.
- [x] **P0** `RecordedSessionFeed` implementing the same feed interface, so recorded live sessions can be replayed (enables the Phase 3 parity test)
  - Added a replay feed for session-recorder NDJSON that filters closed kline records by symbol, interval, and time range, preserves Decimal precision from string fields, sorts candles in time order, and rejects malformed replay lines/candles. Runtime coverage now replays recorded-session candles through the normal backtest path and verifies deterministic fills/metrics. Backtest worker baseline: 278 passing tests across 15 files, type check passes.
- [x] **P0** Metrics: return, CAGR, Sharpe, Sortino, max drawdown, win rate, profit factor, exposure
  - Backtest metrics now include duration-aware CAGR, period-return Sharpe/Sortino, max drawdown, closed-trade win rate/profit factor, and exposure percentage. The runtime passes closed-trade PnLs, exposure bars, request time range, and interval-based annualization into the metrics layer, and the CLI prints the new fields. Backtest worker baseline: 277 passing tests across 15 files, type check passes.
- [x] **P0** Determinism test: same input ⇒ byte-identical output
  - Runtime tests verify identical serialized fills, equity curves, and metrics for repeated runs over both direct candle fixtures and recorded-session replay input.
- [ ] **P1** Walk-forward / train-test split reporting

### 2.3 Reference strategies

- [x] **P0** EMA crossover (with ATR-based position sizing)
  - EMA crossover now supports optional ATR-based entry sizing: `quoteBalance * riskFraction / (ATR * stopAtrMultiple)`, with optional max-quantity cap and validation. Fixed-size behavior remains the default. Backtest worker baseline: 285 passing tests across 15 files, type check passes.
- [x] **P1** Grid or mean-reversion strategy
  - Added a Decimal-safe grid mean-reversion reference strategy using an SMA mean, percentage grid bands, staged market buy/sell intents, max-position caps, irrelevant-candle filtering, and reset behavior. Backtest worker baseline: 308 passing tests across 17 files, type check passes.
- [x] **P1** Buy-and-hold benchmark for comparison in every report
  - Backtest metrics now include buy-and-hold return from first close to last close and strategy-vs-benchmark return. Runtime passes the benchmark into metrics, and CLI summaries print both fields. Backtest worker baseline: 286 passing tests across 15 files, type check passes.

### 2.4 Parallel sweeps

- [ ] **P1** `backtest-worker` with BullMQ + `worker_threads`
- [ ] **P1** `backtest_runs` / `backtest_trades` tables + results CLI
  - Status: started. Added `backtest_runs`, `backtest_fills`, and `backtest_equity_points` schema migration plus a `backtest-worker` result writer that persists run metadata, params, metrics, fills, and equity curve with Decimal values serialized safely. The backtest CLI now supports `--save-run` and optional `--run-id`, runs migrations at startup, saves results, and returns the saved `runId`. Saved-run list/show commands are still pending, so the item remains open.
- [ ] **P1** Report generator (equity curve + drawdown chart as PNG/HTML)

**Exit criteria**

- Backtest results for both strategies over ≥ 6 months, **with fees and slippage on**.
- Determinism test passing in CI.
- A written note on overfitting risk and out-of-sample results.

**Deliverable:** backtest report you can screenshot for the README.

---

## Phase 3 — Execution & risk on Testnet (1.5–2 weeks)

**Goal:** the same strategies trading on Testnet, safely and idempotently.

### 3.1 Authenticated client

- [ ] **P0** Request signing (Ed25519 and HMAC), time-offset sync, `recvWindow`
- [ ] **P0** Order endpoints: place, cancel, query by `clientOrderId`, open orders
- [ ] **P0** User data stream: fills, balance updates; keepalive + reconnect
- [ ] **P0** Environment guard: refuse `production` without explicit override flag
- [ ] **P1** `ExchangeGateway` / `MarketDataSource` interfaces in `packages/core`; `binance-client` and the sim broker both implement them (TRD §4.14)

### 3.2 Order lifecycle

- [ ] **P0** Order state machine in `packages/core` with exhaustive transition tests
- [ ] **P0** Deterministic `clientOrderId` generation that respects Binance's length/charset limits (fixed prefix + truncated hash of strategyId:signalId; verify limits in current docs)
- [ ] **P0** Write-ahead persistence (`NEW/pending` saved before send)
- [ ] **P0** Timeout handling: **query before retry**, never blind-resend
- [ ] **P0** Reconciliation on startup + after reconnect (open orders + recent trades vs DB)
- [ ] **P0** Handle partial fills and out-of-order events
- [ ] **P0** Local states `PENDING_NEW` / `UNKNOWN` / `PENDING_CANCEL` in the state machine with exhaustive transition tests
- [ ] **P0** Fee-aware fills: record `fee` + `fee_asset`; positions net base-asset fees
- [ ] **P1** Tolerate Testnet resets (wiped orders/balances): detect, re-baseline, alert

### 3.3 Engine + executor services

- [ ] **P0** Swap the JSON-bytes codec for generated Protobuf behind `EventCodec` now that the engine is the first real consumer (keep a JSON debug mode)
- [ ] **P0** `engine`: consume `market.*`, run strategies via the same interface, publish `Signal` (with `signal_id` and `valid_until_ms`)
- [ ] **P0** Live `StrategyContext` implementation (wall clock, live positions)
- [ ] **P0** `executor`: consume `signals` → pre-trade validation → risk gate → send
- [ ] **P0** Stale-data guard: no signals acted on if market data is older than threshold
- [ ] **P0** Signal expiry: executor drops signals past `valid_until_ms` and counts them (`signals_expired_total`)

### 3.4 Risk engine

- [ ] **P0** Checks from TRD §4.10 (notional, position, open orders, orders/min, daily loss, drawdown, price sanity)
- [ ] **P0** Kill switch (Redis flag + cancel-all + audit entry + alert), **failing closed**: an unreadable flag counts as engaged; state also recorded in DB so it survives a Redis wipe
- [ ] **P0** Every rejection persisted to `risk_events` with a reason
- [ ] **P1** Auto-trip breakers (drawdown/daily loss) engage the kill switch

### 3.5 Verification

- [ ] **P0** Integration tests with Testcontainers (Redis + Timescale) for the full signal → order → fill loop
- [ ] **P0** **Parity test**: replay a recorded live session through the backtester; signals must match
- [ ] **P0** Crash test: kill executor between "persist" and "send" and between "send" and "ack"; verify no duplicate/lost orders after restart
- [ ] **P0** Fail-closed test: kill Redis ⇒ zero new orders sent and an alert fired; force the write-ahead insert to fail ⇒ nothing sent

**Exit criteria**

- Strategy paper-trades on Testnet for **48h+** without manual intervention.
- Kill switch verified: halts new orders and cancels open ones within seconds.
- Zero duplicate orders across all crash tests.
- Redis killed ⇒ zero new orders (fail closed).

**Deliverable:** screen recording of the bot trading + the kill switch firing.

---

## Phase 4 — API gateway & dashboard (1–1.5 weeks)

**Goal:** operate and observe the system through a browser.

### 4.1 API gateway

- [ ] **P0** Fastify app with `zod` type provider + generated OpenAPI docs
- [ ] **P0** Auth (JWT) with `viewer`/`operator` roles; rate limiting (Redis store)
- [ ] **P0** REST: market history, strategies, orders, positions, backtests
- [ ] **P0** SSE: `/stream/market` and `/stream/account` with heartbeats + `Last-Event-ID`
- [ ] **P0** Server-side throttling/coalescing of book updates per client
- [ ] **P0** Control endpoints (pause/resume/kill switch) with `audit_log`
- [ ] **P1** Backtest job submission + status polling

### 4.2 Dashboard (`apps/web`)

- [ ] **P0** Layout, auth flow, SSE hook with auto-reconnect → Zustand store
- [ ] **P0** Market view: candlestick chart, order book depth, trades tape
- [ ] **P0** Positions / orders / fills tables with live PnL
- [ ] **P0** Strategy controls + **global kill switch button** (with confirmation)
- [ ] **P1** Backtest launcher + results (equity curve, drawdown, trade list)
- [ ] **P1** System health panel (stream age, reconnects, consumer lag)
- [ ] **P1** `requestAnimationFrame`-batched rendering for high-frequency data
- [ ] **P2** Playwright E2E for start/stop and kill switch flows

**Exit criteria**

- Dashboard shows live data with < 1s perceived latency and recovers after the API restarts.
- Load test: 500 concurrent SSE clients on one API instance (k6).

**Deliverable:** dashboard screenshots/GIF for the README.

---

## Phase 5 — Observability, hardening & deployment (1 week)

**Goal:** prove that it's production-grade, not just claim it.

- [ ] **P0** Prometheus metrics from every service (TRD §8); scrape config in `infra/`
- [ ] **P0** Grafana dashboards as code (ingest, bus lag, trading, risk, PnL)
- [ ] **P0** Alert rules (stale data, reconnect storms, lag, drawdown, kill switch, rate-limit hits)
- [ ] **P0** Telegram/Discord alert delivery
- [ ] **P1** OpenTelemetry tracing with `traceId` propagated through event envelopes
- [ ] **P1** Sentry integration
- [ ] **P0** Graceful shutdown handlers in every service (`SIGTERM`)
- [ ] **P0** `/health/live` + `/health/ready` on every service
- [ ] **P0** Multi-stage, non-root Dockerfiles; image size sanity check
- [ ] **P0** **Chaos test scripts**: kill Redis, kill executor, cut network, inject duplicate + out-of-order events
- [ ] **P0** k6 + synthetic feeder benchmark; record events/sec and p95 latencies
- [ ] **P0** Deploy (Fly.io / Railway / VPS) with HTTPS and secrets via provider secret store
- [ ] **P1** CD workflow: tag → build → deploy
- [ ] **P1** Nightly DB backup

**Exit criteria**

- Public URL live; Grafana screenshots captured.
- Chaos suite passes; results documented.
- Benchmark numbers meet (or honestly report against) TRD §10 targets.

---

## Phase 6 — MCP / AI layer (3–5 days)

**Goal:** agents can read and safely operate the platform.

- [ ] **P1** `apps/mcp-server` with `@modelcontextprotocol/sdk`
- [ ] **P1** Read tools: `get_portfolio`, `get_positions`, `get_market_snapshot`, `get_strategy_status`
- [ ] **P1** Action tools with guardrails: `run_backtest` (bounded), `pause_strategy`, `trigger_kill_switch` (all audit-logged)
- [ ] **P0** **Do not expose any order placement tool**
- [ ] **P2** `explain_trade` using stored `Signal.reason` + `risk_events`
- [ ] **P1** zod validation on all tool inputs; bounded outputs
- [ ] **P1** Demo: connect a Claude client and record a short session ("how is my portfolio doing?", "backtest EMA 12/26 on ETH for 3 months")

**Exit criteria**

- Agent can answer portfolio and strategy questions and launch a backtest end-to-end.
- Audit log shows every agent action.

---

## Phase 7 — Polish & resume packaging (3–4 days)

- [ ] **P0** README: problem, architecture diagram, tech-choice rationale, quickstart, screenshots/GIFs, benchmark table, backtest results, limitations (Testnet ≠ production)
- [ ] **P0** `docs/adr/*` completed; link PRD/TRD
- [ ] **P0** Architecture diagram as an image/SVG (Excalidraw or Mermaid)
- [ ] **P0** 2–3 minute demo video (dashboard + kill switch + chaos test + MCP)
- [ ] **P0** Repo hygiene: LICENSE, CONTRIBUTING, issue templates, badges (CI, coverage)
- [ ] **P1** Blog post: "Building a crash-safe trading system in TypeScript" (order book sync, idempotent orders, live/backtest parity)
- [ ] **P0** Final secret scan of the entire git history

### Resume bullet templates (fill with **your real numbers**)

- Built an event-driven algorithmic trading platform in TypeScript (Node.js, Redis Streams, Protobuf, TimescaleDB) processing **{X}k market events/sec** with p95 internal latency of **{Y} ms**.
- Implemented exchange-documented local order book synchronization with sequence-gap detection and automatic resync; verified with property-based tests.
- Designed a unified strategy interface shared by backtesting and live execution, with a parity test proving identical signals on replayed sessions.
- Engineered crash-safe order execution (idempotent client order IDs, write-ahead persistence, exchange reconciliation, kill switch); validated with chaos tests showing **zero duplicate orders**.
- Shipped observability (Prometheus, Grafana, OpenTelemetry) and an MCP server enabling AI agents to query portfolios and run backtests with audit-logged guardrails.

---

## Phase 8 — Optional, post-v1: derivatives exploration

Only start after v1 ships (Phases 0–7 done, README published). Goal: learn the extra risk machinery of leveraged products, not to chase more features.

- [ ] **P2** Read Binance USDⓈ-M Futures docs; write a short note on mark price, funding, leverage, margin ratio, liquidation, one-way vs hedge mode
- [ ] **P2** Second `ExchangeGateway` implementation against the **Futures testnet** (verify it exists and its endpoints in the docs)
- [ ] **P2** New risk checks: max leverage, liquidation distance, funding-rate awareness
- [ ] **P2** Backtester support for funding payments and short positions
- Options are **out of scope**: they need a different strategy model (Greeks, IV, expiry). Treat as a separate project.

---

## Cross-cutting checklists

**Every PR**

- [ ] Tests added/updated · [ ] Types strict, no `any` · [ ] No secrets · [ ] Metrics/logs for new behavior · [ ] Docs/ADR updated

**Weekly**

- [ ] Demo the current phase deliverable to yourself (record it)
- [ ] Review risks in PRD §7; update status
- [ ] Prune scope: move anything non-essential to P2

---

## Cut-list (if you run out of time)

Drop in this order, keeping the core story intact:

1. Playwright E2E, blog post, nightly backup
2. Timescale continuous aggregates / compression (resample in code instead)
3. OpenTelemetry tracing, Sentry
4. Generated Protobuf (keep the JSON-bytes codec behind `EventCodec`; be honest about it in the README)
5. Grid/mean-reversion strategy, walk-forward reporting
6. `explain_trade` MCP tool
7. Parallel parameter sweeps (keep single-run backtests)

**Never cut:** order book sync, decimal math, idempotent orders + reconciliation, risk engine + kill switch **(fail-closed)**, backtest/live parity, Testnet-only guard, README with real numbers.

---

## Suggested next 10 working days (from where you are now)

| Day | Tasks                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------ |
| 1   | Close Phase 0 leftovers: gitleaks pre-commit, Testnet keys in `.env`, secret scan                      |
| 2   | Run migrations on real Timescale; verify live batched writes; kick off a short backfill                |
| 3   | `packages/bus` (publish/consume/ack/`XAUTOCLAIM`) with Testcontainers tests                            |
| 4   | `EventCodec` interface + session recorder; **start the 24h soak**                                      |
| 5   | Phase 2.0: kline feed + EMA crossover + minimal sim broker                                             |
| 6   | Phase 2.0: metrics + `pnpm backtest` CLI + first determinism test (**vertical slice done**)            |
| 7   | Decimal rounding to exchange filters; indicators (SMA/EMA/ATR) with known-value tests                  |
| 8   | Fee-aware position/PnL accounting; intrabar rule                                                       |
| 9   | Full metrics set (Sharpe, Sortino, profit factor, exposure) + buy-and-hold benchmark                   |
| 10  | Check the soak results, spot-check book vs REST snapshot, run the 60s network-kill test, close Phase 1 |

---

## Change log

- **2026-10-04:** Added status snapshot; promoted `packages/bus` to P0; added Phase 1.5 close-out and a Phase 2.0 vertical slice; background wall-clock soaks allowed; added fail-closed, signal expiry, fee-aware accounting, local order states, clientOrderId limits, Testnet-reset tolerance, `ExchangeGateway`, and codec-swap tasks; added optional Phase 8 (derivatives exploration); revised cut-list and next-10-days plan; timeline revised to ~10–12 weeks.
