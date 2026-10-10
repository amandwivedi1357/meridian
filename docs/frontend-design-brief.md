# Meridian Frontend Design Brief

## Purpose

Meridian frontend should feel like a serious trading operations terminal, not a marketing dashboard and not an AI-generated portfolio UI.

The product is not for manual scalping. It is for monitoring an automated Testnet trading system, inspecting evidence, understanding risk, and taking limited operator actions like pause, resume, and kill switch.

The UI should communicate:

- The system is safe or unsafe.
- The market data pipeline is alive or stale.
- Strategies are running, paused, or blocked.
- Orders, fills, and risk decisions are inspectable.
- Operator actions are intentional and audited.
- No direct order placement exists in v1.

## Design Personality

Use a professional trading terminal style inspired by tools like TradingView, Binance terminal, Grafana, Linear, and modern infra dashboards.

The design should feel:

- Dense but readable.
- Calm, not flashy.
- Operational, not decorative.
- Premium, not generic SaaS.
- Evidence-first, not card-heavy.
- Built for repeated daily use.

Avoid:

- Oversized hero sections.
- Gradient blobs or decorative backgrounds.
- Random colorful cards everywhere.
- Fake AI dashboard vibes.
- Huge icons.
- Marketing copy.
- Rounded bubbly components.
- Crypto casino styling.
- Direct “Buy” / “Sell” order placement UI.

## Visual Direction

Preferred look:

- Dark-first terminal theme, with an optional light mode later.
- Neutral charcoal / graphite base.
- Thin borders.
- Compact panels.
- High information density.
- Small typography with clear hierarchy.
- Monospace or tabular numerals for prices, quantities, timestamps, and IDs.
- Green/red only for market side or risk meaning, not decoration.
- Amber for warning/pending.
- Blue or violet only for secondary system/info states.

Panel radius should be subtle, around 6px to 8px.

Cards should only be used for real modules:

- Chart module.
- Order book.
- Trade tape.
- Risk summary.
- Strategy row/detail.
- Table sections.
- Control confirmation modals.

Do not make every page a grid of generic metric cards.

## Global App Shell

The app should have a persistent shell:

- Left sidebar navigation.
- Top status bar.
- Main workspace area.
- Optional right inspector panel on pages where detail inspection matters.

### Sidebar

Navigation items:

- Overview
- Market
- Trading
- Risk
- Strategies
- Backtests
- System

Sidebar should be compact, not wide and decorative.

It should show:

- Meridian logo/name.
- Environment badge: `TESTNET`.
- Kill switch status.
- API connection status.

### Top Bar

Top bar should show:

- Current page title.
- Selected symbol, initially `BTCUSDT`.
- API status.
- Market data freshness.
- Last update time.
- Operator mode status.
- Kill switch button, visually serious but not oversized.

## Pages

## 1. Overview

Goal: one screen to answer whether the platform is safe, alive, and doing what expected.

Sections:

- System status strip:
  - API
  - Redis
  - TimescaleDB
  - Ingestor
  - Engine
  - Executor
- Account summary:
  - Allocated equity
  - Managed position
  - Open orders
  - Recent fills
  - Risk state
- Latest BTCUSDT chart preview.
- Recent trading/risk activity timeline.
- Active strategy summary.

The Overview should not be a wall of cards. It should feel like a compact control room.

## 2. Market

Goal: inspect live market data quality and current BTCUSDT market state.

Sections:

- Main candlestick chart.
- Timeframe selector:
  - 1m
  - 15m
  - 1h
- Order book depth:
  - bids
  - asks
  - spread
- Recent trades tape.
- Market data health:
  - Redis stream length
  - last event age
  - DB persisted count
  - NDJSON recording status

This page can feel closest to a trading terminal, but still no order form.

## 3. Trading

Goal: inspect order lifecycle and execution evidence.

Sections:

- Open orders table.
- Recent orders table.
- Fills table.
- Positions table.
- Unknown/reconciliation queue.

Important states:

- `PENDING_NEW`
- `UNKNOWN`
- `NEW`
- `PARTIALLY_FILLED`
- `FILLED`
- `CANCELED`
- `EXPIRED`
- `REJECTED`

The page should emphasize traceability:

- Client order ID
- Exchange order ID
- Strategy ID
- Signal ID
- State
- Quantity
- Price
- Executed quantity
- Last update time

No direct order placement form.

## 4. Risk

Goal: make safety controls and risk decisions obvious.

Sections:

- Global kill switch state.
- Risk limits:
  - max notional
  - max quantity
  - max position
  - max open orders
  - orders per minute
  - daily loss
  - drawdown
- Current exposure.
- Risk event log.
- Audit log preview.
- Operator actions:
  - Engage kill switch

Potential future action:

- Reset kill switch, but only with explicit confirmation and warning.

Every destructive or enabling action should use a confirmation modal.

## 5. Strategies

Goal: inspect and control strategies.

Sections:

- Strategy list:
  - status
  - symbol
  - interval
  - last signal
  - last run
  - current position
  - PnL summary
- Strategy detail panel:
  - recent decisions
  - signal reason
  - risk approval/rejection
  - last input candle/trade
- Operator controls:
  - pause strategy
  - resume strategy

Resume must require explicit confirmation.

## 6. Backtests

Goal: inspect saved backtest results and later launch bounded backtest jobs.

Sections:

- Saved backtest runs list.
- Equity curve.
- Drawdown chart.
- Metrics:
  - total return
  - max drawdown
  - Sharpe
  - Sortino
  - profit factor
  - trade count
  - win rate
- Trade list.
- HTML report link/download.

Initial frontend may show existing saved runs only. Backtest submission can come later.

## 7. System

Goal: prove infrastructure health.

Sections:

- Service health:
  - API
  - Web
  - Ingestor
  - Engine
  - Executor
  - Backtest worker
- Storage:
  - Redis
  - TimescaleDB
  - NDJSON recording
- Streams:
  - market streams
  - signal streams
  - consumer group lag
  - pending messages
- Migrations:
  - latest applied migration
  - schema status
- Runtime config summary:
  - symbol
  - environment
  - retention
  - allocation mode

## UX Rules

- Read-only data first.
- Write actions must be rare and protected.
- Every operator action must show:
  - what will happen
  - what will not happen
  - audit actor
  - confirmation text
- Show stale/unavailable states clearly.
- Keep loading, empty, error, and partial-data states designed.
- Tables must be first-class UI, not afterthoughts.
- Use dense tables, sticky headers, column alignment, and compact row height.
- Use tabular numerals for all numeric data.
- Keep all money/quantity values as strings from the API.
- Never hide risk warnings behind hover-only UI.

## Components Needed

- AppShell
- Sidebar
- TopStatusBar
- StatusBadge
- MetricStrip
- DataTable
- MarketChart
- OrderBook
- TradeTape
- RiskStatePanel
- StrategyStatusRow
- ConfirmationModal
- EmptyState
- ErrorState
- LoadingSkeleton
- ActivityTimeline
- SystemHealthGrid

## API-Backed Data

Existing API endpoints include:

- `GET /api/dashboard`
- `GET /api/trading/state`
- `GET /api/orders`
- `GET /api/fills`
- `GET /api/positions`
- `GET /api/risk/state`
- `GET /api/risk/events`
- `GET /api/account/summary`
- `POST /api/risk/kill-switch/engage`
- `POST /api/strategies/:strategyId/pause`
- `POST /api/strategies/:strategyId/resume`

Frontend should begin by building a typed API client around these.

## Designer Tool Prompt

Use this prompt in a design generation tool such as Figma AI, Galileo, Uizard, v0, Framer AI, or any UI design assistant.

```txt
Design a premium dark-mode web application UI for "Meridian", a serious algorithmic trading operations terminal.

Meridian is not a manual trading app and not a marketing dashboard. It monitors an automated Binance Spot Testnet trading platform. The UI is for operators to inspect market data, orders, fills, positions, strategies, risk controls, system health, and backtest results. Direct order placement is NOT allowed in the UI.

Visual style:
- Real-world trading terminal / infrastructure dashboard.
- Inspired by TradingView, Binance terminal, Grafana, Linear, and modern observability tools.
- Dark-first interface.
- Dense but readable.
- Calm, professional, precise.
- Thin borders, compact panels, subtle 6-8px radius.
- No decorative gradient blobs.
- No oversized hero sections.
- No generic AI dashboard look.
- No crypto casino styling.
- No random colorful cards.
- Use tabular numerals for prices, quantities, timestamps, IDs, and PnL.
- Use green/red only for market side, PnL, and risk semantics.
- Use amber for warning/pending.
- Use blue/violet sparingly for neutral system information.

Global layout:
- Persistent left sidebar navigation.
- Top status bar.
- Main content workspace.
- Optional right-side detail/inspector panel where useful.
- Navigation items:
  1. Overview
  2. Market
  3. Trading
  4. Risk
  5. Strategies
  6. Backtests
  7. System

Top bar should show:
- Page title.
- Environment badge: TESTNET.
- Selected symbol: BTCUSDT.
- API status.
- Market data freshness.
- Last update time.
- Kill switch status.
- A serious "Engage Kill Switch" operator button.

Create desktop mockups for all pages:

1. Overview
- Compact command-center screen.
- System health strip: API, Redis, TimescaleDB, Ingestor, Engine, Executor.
- Account summary: allocated equity, managed position, open orders, recent fills, risk state.
- BTCUSDT mini chart.
- Recent trading and risk activity timeline.
- Active strategy summary.

2. Market
- Main BTCUSDT candlestick chart.
- Timeframe selector: 1m, 15m, 1h.
- Order book depth panel with bids/asks/spread.
- Recent trade tape.
- Market data health: Redis stream length, last event age, DB persisted count, NDJSON recorder status.

3. Trading
- Orders table with lifecycle states.
- Fills table.
- Positions table.
- Unknown/reconciliation queue.
- Show fields: client order ID, exchange order ID, strategy ID, signal ID, side, type, quantity, executed quantity, price, state, updated time.
- No order placement form.

4. Risk
- Global kill switch state.
- Risk limits: max notional, max quantity, max position, max open orders, orders per minute, daily loss, drawdown.
- Current exposure.
- Risk events table.
- Audit log preview.
- Operator action: engage kill switch with a confirmation pattern.

5. Strategies
- Strategy list with status, symbol, interval, last signal, last run, current position, PnL.
- Strategy detail panel with recent decisions, signal reason, risk approval/rejection, last input candle.
- Operator controls: pause strategy, resume strategy.
- Resume must look like it requires explicit confirmation.

6. Backtests
- Saved backtest run list.
- Equity curve.
- Drawdown chart.
- Metrics: total return, max drawdown, Sharpe, Sortino, profit factor, trade count, win rate.
- Trade list.
- HTML report link.
- Future backtest launcher area, but keep it secondary.

7. System
- Service health: API, Web, Ingestor, Engine, Executor, Backtest Worker.
- Storage health: Redis, TimescaleDB, NDJSON recording.
- Stream health: market streams, consumer lag, pending messages.
- Migration status.
- Runtime config summary: symbol, environment, retention, allocation mode.

UX requirements:
- Design loading, empty, stale, and error states.
- Tables must look polished and production-grade.
- Keep information density high without making it chaotic.
- Prioritize evidence and safety over decoration.
- All write actions must be visually protected and auditable.
- Do not include Buy/Sell trade buttons or manual order forms.

Deliver a cohesive Figma-style design system:
- color tokens
- typography scale
- spacing scale
- table styles
- badge styles
- chart panel styles
- modal/confirmation styles
- button hierarchy
- empty/error/loading states

The final result should look like a real production trading operations terminal that could be shown in a resume demo.
```

## Implementation Note

Once the design direction is accepted, build the frontend in this order:

1. Typed API client.
2. App shell.
3. Read-only Overview.
4. Trading tables.
5. Risk page with guarded operator actions.
6. Strategies page with pause/resume confirmations.
7. Backtests page.
8. System page.
9. Visual polish and responsive pass.

