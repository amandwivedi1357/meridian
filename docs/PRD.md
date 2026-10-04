# Meridian — Product Requirements Document (PRD)

> Working name: **Meridian**. An event-driven algorithmic trading platform built on the Binance Spot API (Testnet for execution, production public streams for market data).

| Field        | Value                              |
| ------------ | ---------------------------------- |
| Status       | Draft v1.1                         |
| Owner        | You                                |
| Last updated | 2026-10-04                         |
| Related docs | `TRD.md`, `implementation-plan.md` |

---

## 1. Overview

Meridian ingests real-time Binance market data, lets a user write trading strategies in TypeScript, validates them with an event-driven backtester, and runs them live against the **Binance Spot Testnet** with a real risk engine, order state machine, and full observability. A dashboard shows live prices, positions, PnL, and system health. An MCP server lets AI agents query and operate the platform through natural language.

### 1.1 Problem statement

Most retail trading bots and portfolio projects are single-file scripts: no reconnection handling, float-based money math, no risk controls, backtests that don't match live behavior, and no visibility into what the system is doing. Meridian addresses each of these as a first-class concern.

### 1.2 Goals

1. **Correctness first**: exact decimal math, idempotent orders, a strict order state machine, and a verified local order book.
2. **One strategy, two modes**: identical strategy code runs in backtest and live with zero changes.
3. **Reliability**: survives WebSocket drops, rate limits, service restarts, and duplicate/out-of-order events.
4. **Observability**: any incident can be diagnosed from metrics, logs, and traces.
5. **Demonstrable**: a live deployed demo, reproducible backtest results, and clear documentation.

### 1.3 Non-goals

- Trading with real funds (Testnet only for order execution).
- Multi-exchange support, Futures/Margin/Options (Spot only in v1).
- Multi-tenant SaaS, billing, or user-facing auth for external customers.
- Ultra-low-latency / co-located HFT. Target is reliable sub-second decisioning, not microseconds.
- Financial advice or profitability guarantees.

### 1.4 Why Spot only (and what could come later)

Binance offers several product families. Meridian deliberately targets **Spot** in v1:

| Product                                        | What it is                                                                                        | Why it is / isn't in v1                                                                                                                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spot**                                       | Buy/sell the actual asset (e.g., BTC for USDT); you own what you buy; no leverage, no liquidation | **In scope.** Simplest correct model: balance + position, no margin math. Mature Testnet. Every hard problem here (order book sync, idempotent orders, risk gate, parity) is fully exercised by Spot.           |
| **Margin**                                     | Spot with borrowed funds                                                                          | Out: adds borrow/interest/liquidation logic without adding new architectural lessons.                                                                                                                           |
| **USDⓈ-M / COIN-M Futures** (incl. perpetuals) | Leveraged contracts on price; long or short; funding payments; liquidation                        | Out of v1. Needs mark price, funding, leverage, margin ratio, liquidation-distance risk checks, hedge/one-way position modes. Worth a **post-v1 extension** (Implementation Plan Phase 8), not a v1 dependency. |
| **Options**                                    | Contracts giving the right to buy/sell at a strike by expiry                                      | Out. Needs Greeks, implied-vol surfaces, expiry handling, and a different strategy API. A separate project, not an extension.                                                                                   |

Design consequence: exchange-specific code stays behind an `ExchangeGateway` interface (FR-1.8, TRD §4.14) so a Futures adapter can be added later without rewriting the engine, risk gate, or backtester.

---

## 2. Target users & personas

| Persona                          | Description                              | Primary needs                                                 |
| -------------------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| **Strategy Developer** (primary) | Developer writing and testing strategies | Simple strategy API, fast backtests, trustworthy metrics      |
| **Operator**                     | Person monitoring live bots              | Live dashboard, alerts, kill switch                           |
| **AI Agent / Assistant**         | LLM client via MCP                       | Structured tools to read state, run backtests, explain trades |
| **Recruiter / Reviewer**         | Evaluates the project                    | Clear README, live demo, architecture rationale               |

---

## 3. Scope

### 3.1 In scope (v1)

- Symbols: configurable allowlist, default `BTCUSDT`, `ETHUSDT`, `BNBUSDT`.
- Market data: trades, klines (1m/5m/15m/1h), partial/diff depth (local order book).
- Strategy SDK with 2 reference strategies (EMA crossover, grid/mean-reversion).
- Event-driven backtester with fees and slippage models.
- Live paper trading on Spot Testnet.
- Risk engine with kill switch.
- Real-time dashboard.
- MCP server exposing platform tools.
- Metrics, logs, traces, alerts.

### 3.2 Out of scope (future)

- Futures/Margin APIs, FIX/SBE integration, portfolio-margin.
- ML-based strategies, hyperparameter optimization beyond grid search.
- Mobile app.

---

## 4. Functional requirements

Priority: **P0** = must ship, **P1** = should ship, **P2** = nice to have.

### 4.1 Market data ingestion

| ID     | Requirement                                                                                                                                                                         | Priority |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-1.1 | Subscribe to trade, kline, and depth streams for allowlisted symbols                                                                                                                | P0       |
| FR-1.2 | Auto-reconnect with exponential backoff + jitter; proactive reconnect before the exchange's max connection lifetime                                                                 | P0       |
| FR-1.3 | Maintain a local order book using the snapshot + diff procedure from Binance docs, with sequence-gap detection and automatic resync                                                 | P0       |
| FR-1.4 | Persist trades and klines to a time-series store                                                                                                                                    | P0       |
| FR-1.5 | Backfill historical klines via REST for backtesting, respecting rate limits                                                                                                         | P0       |
| FR-1.6 | De-duplicate events on reconnect/replay                                                                                                                                             | P0       |
| FR-1.7 | Publish normalized events to the internal event bus                                                                                                                                 | P0       |
| FR-1.8 | Exchange-specific code (REST, streams, signing, filters) sits behind an `ExchangeGateway` / market-data interface in `packages/core`; Binance Spot is the only implementation in v1 | P1       |
| FR-1.9 | Record raw normalized market sessions to disk in a replayable format (feeds parity tests and deterministic debugging)                                                               | P0       |

### 4.2 Strategy & backtesting

| ID      | Requirement                                                                                                                                                                                           | Priority |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-2.1  | Strategy interface: `onCandle`, `onTrade`, `onOrderBook`, `onFill`, `onInit`                                                                                                                          | P0       |
| FR-2.2  | Same strategy class runs unmodified in backtest and live                                                                                                                                              | P0       |
| FR-2.3  | Backtester simulates fills with configurable fees and slippage                                                                                                                                        | P0       |
| FR-2.4  | Metrics: total return, CAGR, Sharpe, Sortino, max drawdown, win rate, profit factor, trade count                                                                                                      | P0       |
| FR-2.5  | Parameter sweep runs in parallel via a job queue                                                                                                                                                      | P1       |
| FR-2.6  | Backtest results stored, comparable, and viewable in the UI                                                                                                                                           | P1       |
| FR-2.7  | Deterministic: same data + params + seed ⇒ identical results                                                                                                                                          | P0       |
| FR-2.8  | Kline-based fills use a documented, conservative intrabar rule (when a candle's range could trigger both a stop/target, assume the worse outcome) so results are not optimistic                       | P0       |
| FR-2.9  | Parity guarantee is defined per strategy class: candle-driven strategies get full backtest/live parity; trade- or book-driven strategies get parity via recorded-session replay (not kline backtests) | P0       |
| FR-2.10 | Every backtest report includes a buy-and-hold benchmark and an out-of-sample section                                                                                                                  | P1       |

### 4.3 Execution & risk

| ID      | Requirement                                                                                                                                                                  | Priority |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-3.1  | Submit market/limit orders to Testnet with a unique `newClientOrderId` (idempotent retries)                                                                                  | P0       |
| FR-3.2  | Track orders through a strict state machine; reconcile with exchange state on startup and after reconnects                                                                   | P0       |
| FR-3.3  | Validate every order against exchange filters (`PRICE_FILTER`, `LOT_SIZE`, `NOTIONAL`, etc.) before sending                                                                  | P0       |
| FR-3.4  | Risk checks before every order: max position size, max order notional, max open orders, daily loss limit, per-symbol exposure                                                | P0       |
| FR-3.5  | **Kill switch**: halts new orders and cancels open orders on demand or when a breaker trips                                                                                  | P0       |
| FR-3.6  | Client-side rate limiter aligned with exchange weight limits; back off on `429`/`418`                                                                                        | P0       |
| FR-3.7  | Consume user data stream for real-time fills and balance updates                                                                                                             | P0       |
| FR-3.8  | **Fail closed**: if a risk-critical dependency cannot be read (kill-switch flag in Redis, market-data freshness, write-ahead DB insert), new orders are blocked, not allowed | P0       |
| FR-3.9  | Every `Signal` carries an expiry (`valid_until_ms`); the executor drops expired signals instead of trading on stale intent                                                   | P0       |
| FR-3.10 | Positions and PnL account for fees, including fees charged in the base asset or in BNB, so quantities and realized PnL match the exchange                                    | P0       |
| FR-3.11 | Tolerate Testnet data resets (balances/orders may be wiped): reconciliation detects and repairs local state rather than crashing                                             | P1       |

### 4.4 Dashboard & API

| ID     | Requirement                                                                 | Priority |
| ------ | --------------------------------------------------------------------------- | -------- |
| FR-4.1 | Live candlestick chart, order book view, and recent trades                  | P0       |
| FR-4.2 | Open positions, orders, fills, and realized/unrealized PnL                  | P0       |
| FR-4.3 | Start/stop/pause individual strategies; global kill switch button           | P0       |
| FR-4.4 | Backtest launcher and results view (equity curve, drawdown, trade list)     | P1       |
| FR-4.5 | System health panel: stream latency, reconnect count, queue lag, error rate | P1       |
| FR-4.6 | Authenticated API (JWT or API-key) with audit log of control actions        | P0       |

### 4.5 AI / MCP layer

| ID     | Requirement                                                                                                   | Priority |
| ------ | ------------------------------------------------------------------------------------------------------------- | -------- |
| FR-5.1 | MCP server exposes read tools: `get_portfolio`, `get_positions`, `get_market_snapshot`, `get_strategy_status` | P1       |
| FR-5.2 | Action tools with guardrails: `run_backtest`, `pause_strategy`, `trigger_kill_switch`                         | P1       |
| FR-5.3 | Tools that place orders are **not** exposed to agents in v1                                                   | P0       |
| FR-5.4 | `explain_trade(tradeId)` returns the signal inputs and risk decisions behind a trade                          | P2       |

### 4.6 Alerts

| ID     | Requirement                                                                                        | Priority |
| ------ | -------------------------------------------------------------------------------------------------- | -------- |
| FR-6.1 | Telegram/Discord alerts for kill-switch, drawdown breach, stream desync, repeated order rejections | P1       |

---

## 5. Non-functional requirements

| ID     | Category        | Requirement                                                                                                                                                                                   |
| ------ | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-1  | Latency         | Market event → strategy signal p95 < 50 ms internal; signal → order submitted p95 < 100 ms (excluding exchange RTT)                                                                           |
| NFR-2  | Throughput      | Sustain ≥ 2,000 market events/sec across all symbols on a single small VM                                                                                                                     |
| NFR-3  | Availability    | Any single service can crash and recover without losing orders or corrupting state                                                                                                            |
| NFR-4  | Data integrity  | Zero float arithmetic on monetary values; no lost or duplicated fills                                                                                                                         |
| NFR-5  | Security        | Secrets never in git; least-privilege API keys; no withdrawal permissions; secrets injected via env/secret manager                                                                            |
| NFR-6  | Observability   | Metrics, structured logs, and traces for every service; dashboards + alerts defined as code                                                                                                   |
| NFR-7  | Testability     | ≥ 80% coverage on core domain logic; integration tests with real Redis/Postgres                                                                                                               |
| NFR-8  | Reproducibility | `docker compose up` brings up the full stack locally                                                                                                                                          |
| NFR-9  | Maintainability | Strict TypeScript, lint/format enforced in CI, ADRs for major decisions                                                                                                                       |
| NFR-10 | Safety          | Fail closed: loss of Redis, stale data, or a failed write-ahead insert can only reduce trading activity, never increase risk. Verified by an automated test (Redis killed ⇒ zero orders sent) |

---

## 6. Success metrics

**Engineering**

- 24h+ continuous run with zero unrecovered stream desyncs.
- Chaos test passes: kill Redis / drop network / restart services with no lost or duplicate orders.
- Backtest and live signal parity test: replaying recorded live data through the backtester yields identical signals (for candle-driven strategies; see FR-2.9).
- Fail-closed test: killing Redis mid-session results in zero new orders and an alert.

**Portfolio / Resume**

- Public repo with architecture diagram, ADRs, and README GIF/screenshots.
- Live demo URL.
- Published benchmark numbers (events/sec, p95 latency) and backtest report.

---

## 7. Risks & mitigations

| Risk                                      | Impact                                                                     | Mitigation                                                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Order book desync                         | Wrong signals                                                              | Sequence validation + automatic resync + metric/alert                                                                                                |
| Exchange rate limiting / IP ban           | Trading halts                                                              | Weight-aware limiter, backoff, read limits from `exchangeInfo` rather than hardcoding                                                                |
| Duplicate order on retry                  | Double exposure                                                            | Deterministic `newClientOrderId` + reconcile before resend                                                                                           |
| Backtest overfitting                      | Misleading results                                                         | Walk-forward split, out-of-sample reporting, fees + slippage on by default                                                                           |
| Testnet ≠ production behavior             | Overstated results                                                         | Document differences (liquidity, fills); label results as paper trading                                                                              |
| Leaked API keys                           | Security incident                                                          | `.env` gitignored, secret scanning in CI, key with trade-only, IP-restricted permissions                                                             |
| Scope creep                               | Never finishes                                                             | Strict phase gates in `implementation-plan.md`; build a thin vertical slice first (Plan §2.0); long wall-clock soak tests may overlap the next phase |
| Fee/quantity drift                        | Wrong positions and PnL (fees can be taken from the received asset or BNB) | Fee-aware accounting (FR-3.10), reconcile against exchange fills                                                                                     |
| Testnet resets or odd fills               | Confusing state after a reset                                              | Reconciliation tolerates wiped state (FR-3.11); document it in the README                                                                            |
| Optimistic backtests (intrabar ambiguity) | Misleading results                                                         | Conservative intrabar rule (FR-2.8), benchmark + out-of-sample reporting                                                                             |

---

## 8. Assumptions & dependencies

- Binance Spot Testnet and public market data streams remain available; endpoint details are verified against the official docs at build time.
- Node.js 22 LTS, PostgreSQL + TimescaleDB, Redis 7+.
- Single-region deployment on a small VM/PaaS is sufficient.

---

## 9. Open questions (with proposed defaults)

Defaults are proposals so work is never blocked; change them by editing this section.

1. **Deploy target:** default Fly.io (simple containers, secrets store); fall back to a small VPS with Docker Compose if Fly's pricing/limits get in the way.
2. **Dashboard auth:** default single-user JWT with `viewer`/`operator` roles (matches TRD §4.11); GitHub OAuth is P2.
3. **Backtest data:** default klines only in v1; trade-level replay is covered by recorded sessions (FR-1.9, FR-2.9).
4. **Futures/Options:** not in v1. Revisit after v1 ships (Implementation Plan Phase 8).

---

## 10. Change log

- **v1.1 (2026-10-04):** Added Spot-vs-derivatives rationale (§1.4); `ExchangeGateway` abstraction (FR-1.8); session recording (FR-1.9); conservative intrabar rule, scoped parity, benchmark (FR-2.8–2.10); fail-closed, signal expiry, fee-aware accounting, testnet-reset tolerance (FR-3.8–3.11); NFR-10; new risks; open questions given default answers.
