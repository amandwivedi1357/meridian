# Meridian — Implementation Plan

| Field | Value |
|---|---|
| Related docs | `PRD.md`, `TRD.md` |
| Estimated duration | ~8–10 weeks part-time (adjust to your pace) |
| Rule | **Do not start a phase until the previous phase's exit criteria are met.** |

Legend: `[ ]` todo · **P0** must-have · **P1** should-have · **P2** nice-to-have

---

## Timeline at a glance

| Phase | Focus | Est. | Demo you can show after it |
|---|---|---|---|
| 0 | Foundation & tooling | 3–4 days | `docker compose up` works, CI green |
| 1 | Market data ingestion | 1–1.5 weeks | Live order book + candles stored in DB |
| 2 | Strategy SDK & backtester | 1.5–2 weeks | Backtest report with real metrics |
| 3 | Execution & risk (Testnet) | 1.5–2 weeks | Bot paper-trading live with kill switch |
| 4 | API & dashboard | 1–1.5 weeks | Live dashboard in the browser |
| 5 | Observability, hardening, deploy | 1 week | Public URL + Grafana + chaos test results |
| 6 | MCP / AI layer | 3–5 days | Agent answering questions about your portfolio |
| 7 | Polish & resume packaging | 3–4 days | README, diagrams, demo video, resume bullets |

---

## Phase 0 — Foundation & tooling (3–4 days)

**Goal:** a repo where every later phase can be built, tested, and shipped consistently.

- [x] **P0** Init monorepo: `pnpm` workspaces + Turborepo; folder structure from TRD §3
- [x] **P0** Shared TS config (`strict`, `noUncheckedIndexedAccess`), ESLint, Prettier, `lint-staged` + Husky
- [x] **P0** `packages/config`: `zod`-validated env loader (fail fast)
- [x] **P0** `packages/observability`: `pino` logger with redaction, `prom-client` registry helper
- [x] **P0** `infra/docker-compose.yml`: Redis 7 (AOF on), TimescaleDB, Prometheus, Grafana
- [x] **P0** GitHub Actions: install → typecheck → lint → test → build
- [ ] **P0** `gitleaks` pre-commit hook + CI step; `.env.example` committed, `.env` ignored
  - Status: `.env.example`, `.env` ignore rule, `.gitleaks.toml`, and CI gitleaks step are done. Pre-commit currently runs `lint-staged`; add gitleaks to the hook before closing this item.
- [ ] **P0** Create Binance **Spot Testnet** API keys (Ed25519 preferred); store in `.env`
- [ ] **P1** `packages/proto` with `buf` config (`buf lint`, `buf breaking` in CI)
- [x] **P1** ADR template in `docs/adr/`; write ADR-001 through ADR-008 stubs from TRD §1.1

**Exit criteria**
- [x] `docker compose up` starts infra; `pnpm test` and CI pass on an empty-but-wired repo.
  - Verified locally: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `docker compose -f infra/docker-compose.yml config`.
- [ ] No secrets in git history.
  - Pending final secret scan after first commit / before publishing.

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
- [ ] **P0** zod-validate + normalize trade/kline/depth events
- [ ] **P0** Protobuf encode → `XADD` to Redis Streams (`market.*`)
- [ ] **P0** Batched writes to Timescale (`trades`, `klines`), idempotent upserts
- [ ] **P0** Dedup by `(symbol, eventId)`
- [ ] **P0** Historical kline backfill CLI (resumable, rate-limit aware)
- [ ] **P1** Continuous aggregates (1m → 5m → 15m → 1h) + compression policy
- [ ] **P1** `packages/bus`: publish/consume/ack, `XAUTOCLAIM` for stuck messages

**Exit criteria**
- Ingestor runs **24h** without an unrecovered desync.
- Book state matches a fresh REST snapshot within tolerance when spot-checked.
- Kill the network for 60s → service recovers automatically, metrics show the reconnect.
- Historical backfill of ≥ 6 months of 1m candles for 3 symbols.

**Deliverable:** short terminal/GIF showing live book + reconnect recovery.

---

## Phase 2 — Strategy SDK & backtester (1.5–2 weeks)

**Goal:** trustworthy backtests using the same `Strategy` interface that live trading will use.

### 2.1 Core domain (`packages/core`)
- [x] **P0** Types: `Candle`, `Trade`, `BookSnapshot`, `OrderIntent`, `Fill`, `Position`
- [x] **P0** `Strategy` and `StrategyContext` interfaces (TRD §4.7)
- [ ] **P0** Decimal helpers + rounding to exchange filters (tick size, step size, min notional)
- [ ] **P0** Indicators (SMA, EMA, RSI, ATR, Bollinger) with unit tests against known values
- [ ] **P0** Position/PnL accounting (average entry, realized/unrealized)

### 2.2 Backtest engine
- [ ] **P0** Data feed reading klines from Timescale in time order
- [ ] **P0** Simulated clock; strategies use `ctx.now()` only
- [ ] **P0** Sim broker: market + limit fills, taker/maker fees, slippage model
- [ ] **P0** Apply the same exchange filters as live
- [ ] **P0** Look-ahead guard: only closed candles delivered
- [ ] **P0** Metrics: return, CAGR, Sharpe, Sortino, max drawdown, win rate, profit factor, exposure
- [ ] **P0** Determinism test: same input ⇒ byte-identical output
- [ ] **P1** Walk-forward / train-test split reporting

### 2.3 Reference strategies
- [ ] **P0** EMA crossover (with ATR-based position sizing)
- [ ] **P1** Grid or mean-reversion strategy
- [ ] **P1** Buy-and-hold benchmark for comparison in every report

### 2.4 Parallel sweeps
- [ ] **P1** `backtest-worker` with BullMQ + `worker_threads`
- [ ] **P1** `backtest_runs` / `backtest_trades` tables + results CLI
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

### 3.2 Order lifecycle
- [ ] **P0** Order state machine in `packages/core` with exhaustive transition tests
- [ ] **P0** Deterministic `clientOrderId` generation
- [ ] **P0** Write-ahead persistence (`NEW/pending` saved before send)
- [ ] **P0** Timeout handling: **query before retry**, never blind-resend
- [ ] **P0** Reconciliation on startup + after reconnect (open orders + recent trades vs DB)
- [ ] **P0** Handle partial fills and out-of-order events

### 3.3 Engine + executor services
- [ ] **P0** `engine`: consume `market.*`, run strategies via the same interface, publish `Signal`
- [ ] **P0** Live `StrategyContext` implementation (wall clock, live positions)
- [ ] **P0** `executor`: consume `signals` → pre-trade validation → risk gate → send
- [ ] **P0** Stale-data guard: no signals acted on if market data is older than threshold

### 3.4 Risk engine
- [ ] **P0** Checks from TRD §4.10 (notional, position, open orders, orders/min, daily loss, drawdown, price sanity)
- [ ] **P0** Kill switch (Redis flag + cancel-all + audit entry + alert)
- [ ] **P0** Every rejection persisted to `risk_events` with a reason
- [ ] **P1** Auto-trip breakers (drawdown/daily loss) engage the kill switch

### 3.5 Verification
- [ ] **P0** Integration tests with Testcontainers (Redis + Timescale) for the full signal → order → fill loop
- [ ] **P0** **Parity test**: replay a recorded live session through the backtester; signals must match
- [ ] **P0** Crash test: kill executor between "persist" and "send" and between "send" and "ack"; verify no duplicate/lost orders after restart

**Exit criteria**
- Strategy paper-trades on Testnet for **48h+** without manual intervention.
- Kill switch verified: halts new orders and cancels open ones within seconds.
- Zero duplicate orders across all crash tests.

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
2. OpenTelemetry tracing, Sentry
3. Grid/mean-reversion strategy, walk-forward reporting
4. `explain_trade` MCP tool
5. Parallel parameter sweeps (keep single-run backtests)

**Never cut:** order book sync, decimal math, idempotent orders + reconciliation, risk engine + kill switch, backtest/live parity, Testnet-only guard, README with real numbers.

---

## Suggested first 5 days (start here)

| Day | Tasks |
|---|---|
| 1 | Monorepo, TS/ESLint/Prettier, config package, `.env.example`, gitleaks |
| 2 | Docker Compose (Redis, Timescale, Prometheus, Grafana), CI pipeline |
| 3 | Binance REST client: `exchangeInfo`, `klines`, `depth` + fixtures/tests |
| 4 | Rate limiter + retry/backoff + decimal parsing |
| 5 | Stream connection manager (reconnect, heartbeat, stale detection) |
