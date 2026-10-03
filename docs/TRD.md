# Meridian — Technical Requirements Document (TRD)

| Field | Value |
|---|---|
| Status | Draft v1.0 |
| Last updated | 2026-09-30 |
| Related docs | `PRD.md`, `implementation-plan.md` |

> Endpoint URLs, stream limits, and rate-limit numbers below must be **verified against the official Binance docs** (https://developers.binance.com) at build time. Read limits dynamically from `exchangeInfo` instead of hardcoding.

---

## 1. Architecture overview

```
                        ┌────────────────────────────────────────────┐
 Binance (prod streams) │                                            │
   ws: trades/klines/   │   ┌──────────┐    Redis Streams            │
   depth ──────────────►│──►│ Ingestor │──► market.* ────┐           │
                        │   └────┬─────┘                 │           │
                        │        │                       ▼           │
                        │        ▼                 ┌───────────┐     │
                        │  TimescaleDB ◄───────────│  Engine   │     │
                        │        ▲                 │ (strategy)│     │
                        │        │                 └─────┬─────┘     │
                        │        │                  signals.*        │
                        │        │                       ▼           │
                        │        │                 ┌───────────┐     │
                        │        │                 │ Risk Gate │     │
                        │        │                 └─────┬─────┘     │
                        │        │              orders.commands      │
                        │        │                       ▼           │
 Binance Testnet ◄──────│────────┼─────────────────┌───────────┐     │
  REST + WS API +       │        │                 │ Executor  │     │
  user data stream ────►│────────┼────────────────►└─────┬─────┘     │
                        │        │                 orders.events     │
                        │        ▼                       │           │
                        │   ┌─────────────────────────────▼───┐      │
                        │   │ API Gateway (Fastify)           │      │
                        │   │ REST + SSE + WS                 │      │
                        │   └───────┬─────────────────┬───────┘      │
                        │           ▼                 ▼              │
                        │      React Dashboard    MCP Server         │
                        │                                            │
                        │   Backtest Worker (BullMQ) ── TimescaleDB  │
                        └────────────────────────────────────────────┘
```

### 1.1 Key architectural decisions (ADR summary)

| # | Decision | Rationale | Alternatives rejected |
|---|---|---|---|
| ADR-1 | Event-driven services over Redis Streams | Decoupling, replay, consumer groups, light ops | Kafka (overkill), plain pub/sub (no persistence/ack) |
| ADR-2 | Protobuf for internal events, JSON at the edges | Compact, versioned schemas, type-safe; JSON stays debuggable for browsers/public API | JSON everywhere (no schema evolution), Protobuf everywhere (harder for frontend) |
| ADR-3 | Single `Strategy` interface for backtest + live | Eliminates backtest/live divergence | Separate engines |
| ADR-4 | SSE for one-way streams, WS for bidirectional | SSE has native reconnect and is simpler through proxies | WS for everything |
| ADR-5 | TimescaleDB | Hypertables, compression, continuous aggregates for candles | Plain Postgres partitioning, InfluxDB |
| ADR-6 | Decimal arithmetic everywhere | Float errors in money are unacceptable | `number` |
| ADR-7 | Execute on Testnet only, market data from production public streams | Real market shape, zero financial risk | Testnet data only (thin/unrealistic) |
| ADR-8 | Monorepo (pnpm + Turborepo) | Shared types/proto/config, atomic changes | Polyrepo |

---

## 2. Technology stack

| Layer | Choice |
|---|---|
| Language/runtime | TypeScript 5.x (`strict`, `noUncheckedIndexedAccess`), Node.js 22 LTS |
| Monorepo | pnpm workspaces + Turborepo |
| HTTP framework | Fastify + `zod` (via `fastify-type-provider-zod`), OpenAPI generation |
| WebSocket client | `ws` with custom connection manager |
| Event bus / cache | Redis 7 (Streams, consumer groups, hashes), `ioredis` |
| Serialization | Protobuf via `@bufbuild/protobuf` + `buf` CLI |
| Database | PostgreSQL 16 + TimescaleDB; `Kysely` or `Drizzle` for queries and migrations |
| Job queue | BullMQ (Redis-backed) + `worker_threads` |
| Money math | `decimal.js` |
| Frontend | React + Vite, TanStack Query, Zustand, TradingView Lightweight Charts, Tailwind |
| AI layer | `@modelcontextprotocol/sdk` |
| Logging | `pino` |
| Metrics | `prom-client` → Prometheus → Grafana |
| Tracing | OpenTelemetry (OTLP) → Tempo/Jaeger |
| Errors | Sentry |
| Testing | Vitest, Testcontainers, `fast-check`, k6 |
| CI/CD | GitHub Actions |
| Packaging | Docker (multi-stage), Docker Compose |

---

## 3. Repository layout

```
meridian/
├── apps/
│   ├── ingestor/          # WS streams → normalize → Redis + Timescale
│   ├── engine/            # runs strategies, emits signals
│   ├── executor/          # risk gate + order placement + reconciliation
│   ├── backtest-worker/   # BullMQ consumer, runs backtests
│   ├── api/               # Fastify gateway (REST/SSE/WS)
│   ├── mcp-server/        # MCP tools for AI agents
│   └── web/               # React dashboard
├── packages/
│   ├── core/              # domain types, Strategy interface, order state machine, indicators
│   ├── binance-client/    # REST + WS API + streams + signing + rate limiter
│   ├── proto/             # .proto files + generated TS
│   ├── bus/               # Redis Streams wrapper (publish/consume/ack/claim)
│   ├── db/                # migrations, queries
│   ├── config/            # zod-validated env config
│   └── observability/     # logger, metrics, tracing setup
├── infra/                 # docker-compose, Grafana dashboards, Prometheus rules
├── docs/                  # PRD, TRD, ADRs, plan
└── .github/workflows/
```

---

## 4. Component specifications

### 4.1 `binance-client`
- **REST client**: typed methods for `exchangeInfo`, `klines`, `depth`, `order`, `openOrders`, `account`, `userDataStream`.
- **Signing**: pluggable signer supporting HMAC-SHA256 and Ed25519 (Ed25519 preferred for production-style setups).
- **Rate limiter**: token bucket keyed by weight; initial limits loaded from `exchangeInfo.rateLimits`; updates from response headers (`X-MBX-USED-WEIGHT-*`); honors `Retry-After` on `429`/`418`.
- **Retry policy**: retry only idempotent calls or calls carrying a `newClientOrderId`; exponential backoff with jitter; circuit breaker (`opossum`) on repeated failures.
- **Time sync**: track server-time offset and apply to `timestamp`; set an explicit `recvWindow`.
- **Environment switch**: `BINANCE_ENV=testnet|production` selects base URLs; the executor refuses to start in `production` unless an explicit override flag is set.

### 4.2 Stream connection manager
State machine: `IDLE → CONNECTING → OPEN → (STALE | CLOSING) → BACKOFF → CONNECTING`.

| Behavior | Detail |
|---|---|
| Heartbeat | Respond to server pings; also monitor "last message age" and mark `STALE` if no data within a threshold |
| Reconnect | Exponential backoff (e.g., 250ms → 30s cap) with full jitter |
| Proactive rotation | Reconnect before the exchange's maximum connection lifetime using a make-before-break swap to avoid data gaps |
| Subscription mgmt | Re-subscribe automatically; chunk subscriptions to respect per-connection stream limits |
| Emit | `open`, `close`, `stale`, `resync-required` events + metrics |

### 4.3 Local order book (per symbol)
Follows the procedure in the Binance docs for managing a local order book:

1. Open the diff depth stream and **buffer** events.
2. Fetch a REST depth snapshot; note `lastUpdateId`.
3. Discard buffered events where `u <= lastUpdateId`.
4. First applied event must satisfy `U <= lastUpdateId + 1 <= u`.
5. Each subsequent event must satisfy `U == previous.u + 1`; otherwise **mark desynced and restart from step 1**.
6. A quantity of `0` removes the price level.

Implementation notes:
- Sorted structure per side (e.g., a tree or sorted array with binary search); best-bid/ask and top-N in O(log n).
- `fast-check` property tests: random diff sequences vs. a naive reference implementation.
- Exposed metrics: `orderbook_resync_total`, `orderbook_update_lag_ms`.

### 4.4 Ingestor pipeline
```
WS message → validate (zod) → normalize → dedupe (symbol+eventId) → encode (protobuf)
          → XADD to Redis Stream  ┐
          → batch insert to Timescale (flush every N ms or N rows) ┘
```
- Backpressure: bounded in-memory queue; if DB is slow, drop nothing from the bus, but shed to a disk-backed retry buffer / log a metric.
- Klines: only closed candles are persisted as final; in-progress candles are published as `partial`.

### 4.5 Event bus (`packages/bus`)
| Stream | Producer | Consumers | Payload |
|---|---|---|---|
| `market.trade.{symbol}` | ingestor | engine, api | `Trade` |
| `market.kline.{symbol}.{interval}` | ingestor | engine, api | `Kline` |
| `market.book.{symbol}` | ingestor | engine, api | `BookSnapshot` (throttled) |
| `signals` | engine | executor | `Signal` |
| `orders.commands` | executor (post-risk) | executor worker | `OrderCommand` |
| `orders.events` | executor | engine, api, db writer | `OrderEvent` |
| `control` | api, mcp-server | engine, executor | `ControlCommand` (pause, kill switch) |

Conventions:
- Consumer groups with explicit `XACK`; pending-entry reclaim (`XAUTOCLAIM`) for crashed consumers.
- Streams trimmed with `MAXLEN ~` / `MINID`; retention configured per stream.
- Every message carries `eventId`, `ts`, `schemaVersion`, and `traceId`.
- Handlers must be **idempotent**.

### 4.6 Protobuf schemas (`packages/proto`)
Illustrative:

```proto
syntax = "proto3";
package meridian.v1;

message Decimal { string value = 1; } // decimal as string; never float

message Trade {
  string symbol = 1;
  uint64 trade_id = 2;
  Decimal price = 3;
  Decimal quantity = 4;
  int64 event_time_ms = 5;
  bool is_buyer_maker = 6;
}

message Signal {
  string strategy_id = 1;
  string symbol = 2;
  Side side = 3;
  Decimal target_qty = 4;
  OrderType type = 5;
  Decimal limit_price = 6;
  string reason = 7;          // feeds explain_trade
  int64 ts_ms = 8;
}

message OrderEvent {
  string client_order_id = 1;
  string exchange_order_id = 2;
  OrderStatus status = 3;
  Decimal filled_qty = 4;
  Decimal avg_price = 5;
  int64 ts_ms = 6;
}
```
- `buf lint` and `buf breaking` run in CI to enforce backward compatibility.
- Never reuse or renumber fields.

### 4.7 Strategy SDK (`packages/core`)

```ts
export interface StrategyContext {
  now(): number;                                  // simulated in backtest, wall-clock in live
  position(symbol: string): Position;
  balance(asset: string): Decimal;
  submit(intent: OrderIntent): void;              // routed to sim broker OR live signals
  log(msg: string, data?: object): void;
}

export interface Strategy {
  readonly id: string;
  onInit?(ctx: StrategyContext): void | Promise<void>;
  onCandle?(c: Candle, ctx: StrategyContext): void;
  onTrade?(t: Trade, ctx: StrategyContext): void;
  onOrderBook?(b: BookSnapshot, ctx: StrategyContext): void;
  onFill?(f: Fill, ctx: StrategyContext): void;
}
```
Rules: strategies are pure with respect to I/O (no `fetch`, no `Date.now()`, no `Math.random()` outside `ctx`), which is what guarantees deterministic backtests and live/backtest parity.

### 4.8 Backtest engine
- **Event loop**: merges time-ordered events from the data feed into a single ordered stream, advancing a simulated clock.
- **Sim broker**: implements the same `submit` contract as the live executor.
  - Fill model: market orders fill at next available price ± slippage; limit orders fill when price crosses.
  - Fees: configurable maker/taker bps.
  - Applies the same exchange filters (tick size, lot size, min notional).
- **Look-ahead bias guard**: strategies only see candles once closed.
- **Metrics module**: equity curve, returns series, Sharpe, Sortino, max drawdown, win rate, profit factor, exposure.
- **Parallel sweeps**: BullMQ job per parameter set, executed in `worker_threads`; results stored in `backtest_runs` / `backtest_trades`.
- **Parity test**: record a live session → replay through backtester → assert identical signals.

### 4.9 Executor
**Order state machine**

```
NEW ──► PARTIALLY_FILLED ──► FILLED
 │            │
 ├────────────┴──► CANCELED
 ├──────────────► REJECTED
 └──────────────► EXPIRED
```
Illegal transitions are rejected and logged. Out-of-order exchange events are handled by comparing exchange event time / cumulative filled quantity.

**Order flow**
1. Receive `Signal` → generate deterministic `clientOrderId` (e.g., `mrd-{strategyId}-{signalId}`).
2. **Pre-trade validation**: exchange filters (round to tick/step size), balance check.
3. **Risk gate** (see 4.10).
4. Persist order as `NEW (pending)` **before** sending (write-ahead).
5. Send to exchange through the rate limiter.
6. On timeout/unknown result → **query by `clientOrderId` before retrying**.
7. Consume user data stream → update state → publish `OrderEvent`.

**Reconciliation**: on startup and after each reconnect, fetch open orders + recent trades, diff against the local DB, repair state, and emit a reconciliation report.

### 4.10 Risk engine
Synchronous checks, all must pass:

| Check | Configurable |
|---|---|
| Max order notional | per symbol |
| Max position size / exposure | per symbol + global |
| Max open orders | global |
| Max orders per minute | per strategy |
| Daily realized loss limit | global + per strategy |
| Max drawdown from equity peak | global |
| Price sanity (deviation from mid > X%) | per symbol |
| Stale-data guard (no trading if market data older than N ms) | global |

**Kill switch**: sets a Redis flag read by the executor on every order; when engaged, it blocks new orders, cancels open orders, publishes an alert, and records an audit entry. Can be triggered manually (API/UI/MCP) or automatically by breakers. Resetting requires an explicit authenticated action.

### 4.11 API gateway
| Endpoint group | Transport | Notes |
|---|---|---|
| `/v1/market/*` (candles, book snapshot) | REST | Read from Timescale/Redis |
| `/v1/stream/market` | SSE | Prices, trades, book deltas (throttled, e.g. 4–10 Hz per client) |
| `/v1/stream/account` | SSE | Orders, fills, PnL |
| `/v1/strategies/*` | REST | List, start, stop, configure |
| `/v1/backtests/*` | REST | Create job, poll status, fetch results |
| `/v1/control` | REST or WS | Kill switch, pause/resume |
| `/v1/health`, `/metrics` | REST | Liveness/readiness, Prometheus |

- Auth: JWT (short-lived) or API key; role-based (`viewer`, `operator`).
- Rate limiting per client (`@fastify/rate-limit` with Redis store).
- SSE: `Last-Event-ID` support for resume; heartbeat comments every ~15 s.
- All control actions are written to an `audit_log` table.

### 4.12 MCP server
| Tool | Access | Guardrail |
|---|---|---|
| `get_portfolio` | read | none |
| `get_positions` | read | none |
| `get_market_snapshot` | read | symbol allowlist |
| `get_strategy_status` | read | none |
| `run_backtest` | action | max range/param combos, queued via BullMQ |
| `pause_strategy` | action | audit-logged |
| `trigger_kill_switch` | action | audit-logged |
| `explain_trade` | read | uses stored `Signal.reason` + risk decisions |

**No tool places or amends orders.** Tool inputs validated with `zod`; outputs are bounded in size.

### 4.13 Frontend
- Views: Overview, Market (chart + book + trades), Strategies, Orders/Fills, Backtests, System Health.
- Data: TanStack Query for REST, an SSE hook with auto-reconnect that writes into a Zustand store; throttled rendering (`requestAnimationFrame` batching) for high-frequency updates.
- Charts: Lightweight Charts for candlesticks and equity curves.

---

## 5. Data model

**Timescale hypertables**
```sql
trades        (symbol, trade_id, ts, price NUMERIC, qty NUMERIC, is_buyer_maker)  -- PK (symbol, trade_id, ts)
klines        (symbol, interval, open_time, o,h,l,c,v NUMERIC, closed BOOL)       -- PK (symbol, interval, open_time)
```
- Compression policy on chunks older than N days.
- Continuous aggregates: `klines_1m → 5m → 15m → 1h`.
- Retention policy on raw `trades` (e.g., 30 days).

**Relational tables**
```sql
strategies     (id, name, params JSONB, status, created_at)
signals        (id, strategy_id, symbol, side, qty, reason, ts)
orders         (client_order_id PK, exchange_order_id, symbol, side, type, qty, price,
                status, filled_qty, avg_price, created_at, updated_at, strategy_id, signal_id)
fills          (id, client_order_id FK, price, qty, fee, fee_asset, ts, exchange_trade_id UNIQUE)
positions      (strategy_id, symbol, qty, avg_entry, realized_pnl, updated_at)
risk_events    (id, ts, type, details JSONB)
backtest_runs  (id, strategy, params JSONB, range, metrics JSONB, status, created_at)
backtest_trades(run_id FK, ts, symbol, side, qty, price, fee, pnl)
audit_log      (id, ts, actor, action, details JSONB)
```
- `NUMERIC` for all monetary values; `decimal.js` in code; protobuf `Decimal` as string.
- Unique constraints (`exchange_trade_id`, `client_order_id`) enforce idempotency at the DB level.

---

## 6. Reliability & failure handling

| Failure | Expected behavior |
|---|---|
| Binance WS disconnect | Reconnect with backoff; order book resyncs; engine marks data stale and pauses trading until fresh |
| Sequence gap in depth | Resync book; emit metric + log |
| Redis restart | Clients reconnect; consumers resume from group offsets (persistence: AOF enabled) |
| DB slow/unavailable | Ingestor buffers with bounds; trading path does **not** depend on DB reads on the hot path |
| Executor crash mid-order | On restart: reconcile via `clientOrderId` and open-orders query; no duplicate sends |
| Exchange `429`/`418` | Stop sending, honor `Retry-After`, alert if repeated |
| Unknown order outcome (timeout) | Query by `clientOrderId`; never blind-retry |
| Clock drift | Server-time offset sync; `recvWindow` tuned |

Graceful shutdown: on `SIGTERM`, stop consuming, finish in-flight, flush buffers, ack, close connections.

---

## 7. Security

- API keys in environment variables/secret manager only; `.env*` in `.gitignore`; `gitleaks` in CI and pre-commit.
- Exchange keys: trade-only, **withdrawals disabled**, IP-restricted where supported.
- Executor hard-fails if `BINANCE_ENV=production` without an explicit override.
- Dependency hygiene: `pnpm audit`, Renovate/Dependabot, lockfile committed.
- Dashboard/API: HTTPS, CORS allowlist, JWT expiry, secure cookies if sessions are used, input validation on every route.
- Redact secrets and signatures in logs (`pino` redaction paths).
- Container hardening: non-root user, minimal base image, read-only filesystem where possible.

---

## 8. Observability

**Metrics (Prometheus)**
- `ws_reconnects_total{stream}`, `ws_last_message_age_seconds`
- `ingest_events_total{type}`, `ingest_to_bus_latency_ms` (histogram)
- `bus_consumer_lag{stream,group}`, `bus_pending_entries`
- `strategy_signal_latency_ms`, `order_submit_latency_ms`, `order_fill_latency_ms`
- `orders_total{status}`, `risk_rejections_total{reason}`, `kill_switch_active`
- `binance_used_weight`, `binance_http_status_total{code}`
- `pnl_realized`, `pnl_unrealized`, `drawdown_pct`

**Logs**: JSON via `pino`, with `traceId`, `strategyId`, `clientOrderId`, `symbol` fields.

**Tracing**: OpenTelemetry spans from ingestion → signal → risk → order → fill, with `traceId` propagated through the event envelope.

**Alerts (Prometheus rules / Grafana)**: stale market data, high reconnect rate, consumer lag, drawdown breach, kill switch engaged, repeated order rejections, exchange rate-limit hits.

---

## 9. Testing strategy

| Level | Tooling | Focus |
|---|---|---|
| Unit | Vitest | Indicators, order state machine, risk checks, decimal rounding to filters |
| Property-based | `fast-check` | Order book application vs. reference model; state machine transitions |
| Integration | Vitest + Testcontainers | Redis Streams consumer groups, Timescale writes, executor reconciliation |
| Contract | recorded fixtures | Parse real Binance payloads; detect schema drift |
| Replay/parity | recorded sessions | Live signals == backtest signals on the same data |
| Chaos | scripts + Docker | Kill Redis/executor mid-flight, drop network, inject duplicate/out-of-order events |
| Load | k6 + synthetic feeder | SSE fan-out; ingestor at 2k+ events/sec |
| E2E | Playwright | Dashboard critical flows (start/stop strategy, kill switch) |

CI gates: typecheck, lint, unit + integration, `buf breaking`, coverage threshold, `gitleaks`, Docker build.

---

## 10. Performance targets & benchmarking

| Metric | Target |
|---|---|
| Ingest → bus p95 | < 10 ms |
| Bus → strategy p95 | < 20 ms |
| Signal → order submitted (internal) p95 | < 100 ms |
| Sustained ingest | ≥ 2,000 events/s on 2 vCPU / 2 GB |
| SSE fan-out | 500 concurrent clients on a single API instance |

Publish benchmark method + results in the README.

---

## 11. Deployment

- **Local**: `docker compose up` (Redis, Timescale, all services, Prometheus, Grafana).
- **Cloud**: single VM or PaaS (Fly.io/Railway) running the same containers; managed Postgres/Redis optional.
- **Config**: `zod`-validated env schema; fail fast on misconfiguration.
- **Migrations**: run as a one-shot job before services start.
- **Health**: `/health/live` and `/health/ready` on every service.
- **Backups**: nightly `pg_dump` (or provider snapshots); Redis AOF.

---

## 12. Definition of Done (per feature)
1. Code merged with passing CI.
2. Unit + integration tests included.
3. Metrics/logs added for new behavior.
4. Docs/ADR updated.
5. Manually verified on Testnet where applicable.
