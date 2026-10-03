# Meridian — Product Requirements Document (PRD)

> Working name: **Meridian**. An event-driven algorithmic trading platform built on the Binance Spot API (Testnet for execution, production public streams for market data).

| Field | Value |
|---|---|
| Status | Draft v1.0 |
| Owner | You |
| Last updated | 2026-09-30 |
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

---

## 2. Target users & personas

| Persona | Description | Primary needs |
|---|---|---|
| **Strategy Developer** (primary) | Developer writing and testing strategies | Simple strategy API, fast backtests, trustworthy metrics |
| **Operator** | Person monitoring live bots | Live dashboard, alerts, kill switch |
| **AI Agent / Assistant** | LLM client via MCP | Structured tools to read state, run backtests, explain trades |
| **Recruiter / Reviewer** | Evaluates the project | Clear README, live demo, architecture rationale |

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
| ID | Requirement | Priority |
|---|---|---|
| FR-1.1 | Subscribe to trade, kline, and depth streams for allowlisted symbols | P0 |
| FR-1.2 | Auto-reconnect with exponential backoff + jitter; proactive reconnect before the exchange's max connection lifetime | P0 |
| FR-1.3 | Maintain a local order book using the snapshot + diff procedure from Binance docs, with sequence-gap detection and automatic resync | P0 |
| FR-1.4 | Persist trades and klines to a time-series store | P0 |
| FR-1.5 | Backfill historical klines via REST for backtesting, respecting rate limits | P0 |
| FR-1.6 | De-duplicate events on reconnect/replay | P0 |
| FR-1.7 | Publish normalized events to the internal event bus | P0 |

### 4.2 Strategy & backtesting
| ID | Requirement | Priority |
|---|---|---|
| FR-2.1 | Strategy interface: `onCandle`, `onTrade`, `onOrderBook`, `onFill`, `onInit` | P0 |
| FR-2.2 | Same strategy class runs unmodified in backtest and live | P0 |
| FR-2.3 | Backtester simulates fills with configurable fees and slippage | P0 |
| FR-2.4 | Metrics: total return, CAGR, Sharpe, Sortino, max drawdown, win rate, profit factor, trade count | P0 |
| FR-2.5 | Parameter sweep runs in parallel via a job queue | P1 |
| FR-2.6 | Backtest results stored, comparable, and viewable in the UI | P1 |
| FR-2.7 | Deterministic: same data + params + seed ⇒ identical results | P0 |

### 4.3 Execution & risk
| ID | Requirement | Priority |
|---|---|---|
| FR-3.1 | Submit market/limit orders to Testnet with a unique `newClientOrderId` (idempotent retries) | P0 |
| FR-3.2 | Track orders through a strict state machine; reconcile with exchange state on startup and after reconnects | P0 |
| FR-3.3 | Validate every order against exchange filters (`PRICE_FILTER`, `LOT_SIZE`, `NOTIONAL`, etc.) before sending | P0 |
| FR-3.4 | Risk checks before every order: max position size, max order notional, max open orders, daily loss limit, per-symbol exposure | P0 |
| FR-3.5 | **Kill switch**: halts new orders and cancels open orders on demand or when a breaker trips | P0 |
| FR-3.6 | Client-side rate limiter aligned with exchange weight limits; back off on `429`/`418` | P0 |
| FR-3.7 | Consume user data stream for real-time fills and balance updates | P0 |

### 4.4 Dashboard & API
| ID | Requirement | Priority |
|---|---|---|
| FR-4.1 | Live candlestick chart, order book view, and recent trades | P0 |
| FR-4.2 | Open positions, orders, fills, and realized/unrealized PnL | P0 |
| FR-4.3 | Start/stop/pause individual strategies; global kill switch button | P0 |
| FR-4.4 | Backtest launcher and results view (equity curve, drawdown, trade list) | P1 |
| FR-4.5 | System health panel: stream latency, reconnect count, queue lag, error rate | P1 |
| FR-4.6 | Authenticated API (JWT or API-key) with audit log of control actions | P0 |

### 4.5 AI / MCP layer
| ID | Requirement | Priority |
|---|---|---|
| FR-5.1 | MCP server exposes read tools: `get_portfolio`, `get_positions`, `get_market_snapshot`, `get_strategy_status` | P1 |
| FR-5.2 | Action tools with guardrails: `run_backtest`, `pause_strategy`, `trigger_kill_switch` | P1 |
| FR-5.3 | Tools that place orders are **not** exposed to agents in v1 | P0 |
| FR-5.4 | `explain_trade(tradeId)` returns the signal inputs and risk decisions behind a trade | P2 |

### 4.6 Alerts
| ID | Requirement | Priority |
|---|---|---|
| FR-6.1 | Telegram/Discord alerts for kill-switch, drawdown breach, stream desync, repeated order rejections | P1 |

---

## 5. Non-functional requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-1 | Latency | Market event → strategy signal p95 < 50 ms internal; signal → order submitted p95 < 100 ms (excluding exchange RTT) |
| NFR-2 | Throughput | Sustain ≥ 2,000 market events/sec across all symbols on a single small VM |
| NFR-3 | Availability | Any single service can crash and recover without losing orders or corrupting state |
| NFR-4 | Data integrity | Zero float arithmetic on monetary values; no lost or duplicated fills |
| NFR-5 | Security | Secrets never in git; least-privilege API keys; no withdrawal permissions; secrets injected via env/secret manager |
| NFR-6 | Observability | Metrics, structured logs, and traces for every service; dashboards + alerts defined as code |
| NFR-7 | Testability | ≥ 80% coverage on core domain logic; integration tests with real Redis/Postgres |
| NFR-8 | Reproducibility | `docker compose up` brings up the full stack locally |
| NFR-9 | Maintainability | Strict TypeScript, lint/format enforced in CI, ADRs for major decisions |

---

## 6. Success metrics

**Engineering**
- 24h+ continuous run with zero unrecovered stream desyncs.
- Chaos test passes: kill Redis / drop network / restart services with no lost or duplicate orders.
- Backtest and live signal parity test: replaying recorded live data through the backtester yields identical signals.

**Portfolio / Resume**
- Public repo with architecture diagram, ADRs, and README GIF/screenshots.
- Live demo URL.
- Published benchmark numbers (events/sec, p95 latency) and backtest report.

---

## 7. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Order book desync | Wrong signals | Sequence validation + automatic resync + metric/alert |
| Exchange rate limiting / IP ban | Trading halts | Weight-aware limiter, backoff, read limits from `exchangeInfo` rather than hardcoding |
| Duplicate order on retry | Double exposure | Deterministic `newClientOrderId` + reconcile before resend |
| Backtest overfitting | Misleading results | Walk-forward split, out-of-sample reporting, fees + slippage on by default |
| Testnet ≠ production behavior | Overstated results | Document differences (liquidity, fills); label results as paper trading |
| Leaked API keys | Security incident | `.env` gitignored, secret scanning in CI, key with trade-only, IP-restricted permissions |
| Scope creep | Never finishes | Strict phase gates in `implementation-plan.md` |

---

## 8. Assumptions & dependencies
- Binance Spot Testnet and public market data streams remain available; endpoint details are verified against the official docs at build time.
- Node.js 22 LTS, PostgreSQL + TimescaleDB, Redis 7+.
- Single-region deployment on a small VM/PaaS is sufficient.

---

## 9. Open questions
1. Deploy target: Fly.io, Railway, or a VPS?
2. Dashboard auth: single-user JWT or GitHub OAuth?
3. Should backtests use tick-level trades or kline-only data in v1? (Default: klines, with trade-level as P2.)
