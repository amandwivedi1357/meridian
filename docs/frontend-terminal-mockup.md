# Meridian Terminal Mockup Specification

This file translates the approved visual direction into an implementation-ready frontend mockup.

Use this as the starting point for the frontend coding agent.

## Visual Reference Direction

The desired UI should look like a real dark trading operations terminal:

- Dense, serious, and functional.
- Similar energy to a professional bot-monitoring trading terminal.
- Left strategy rail.
- Central market chart.
- Right risk/order-book panel.
- Bottom execution/event log.
- Top market/account status strip.

The design should be closer to a production trading dashboard than a SaaS landing page.

Avoid:

- Generic AI dashboard cards.
- Decorative gradients.
- Oversized headings.
- Big friendly illustrations.
- Manual trading forms.
- Crypto casino styling.

## Product Framing

Meridian is an automated trading operations dashboard.

The UI is for:

- Strategy developers.
- Operators monitoring Testnet execution.
- Resume/demo reviewers who need to understand system quality quickly.

The UI is not for:

- Manual buy/sell trading.
- Real-money production trading.
- Marketing visitors.

## Core Layout

Desktop-first layout:

```txt
┌──────────────────────────────────────────────────────────────────────────────┐
│ Top Bar: brand, page tabs, market tickers, account equity, system status     │
├──────────────┬───────────────────────────────────────────────┬───────────────┤
│ Left Rail    │ Main Chart / Page Workspace                   │ Right Panel   │
│              │                                               │               │
│ Strategies   │ BTCUSDT chart                                 │ Risk exposure │
│ Strategy     │ Signals overlaid                              │ Order book    │
│ cards        │ EMA lines / fills / decisions                 │ Recent trades │
│              │                                               │ Controls      │
├──────────────┴───────────────────────────────────────────────┴───────────────┤
│ Bottom Panel: execution log / risk events / system events                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

Responsive behavior:

- Desktop: three-column terminal layout.
- Tablet: left rail collapses to icon rail, right panel becomes collapsible.
- Mobile: stack pages vertically; tables become horizontal scroll sections.

## Navigation

Top navigation tabs:

- Dashboard
- Strategies
- Analytics
- Settings

Optional later:

- Backtests
- System

For the first frontend slice, keep the terminal structure but implement only the Dashboard page fully. Other tabs can show polished placeholder states.

## Top Bar

Top bar content:

- Meridian brand.
- Main nav tabs.
- Market ticker strip:
  - BTCUSDT with price and percent change.
  - ETHUSDT with price and percent change.
  - SOLUSDT with price and percent change.
  - XRPUSDT with price and percent change.
- Account summary:
  - Total allocated equity.
  - Today PnL.
  - Margin/risk used.
- System connection indicator.
- Operator/account label.

Example:

```txt
MERIDIAN | Dashboard | Strategies | Analytics | Settings
BTC/USDT 83,884.22 +2.41%
ETH/USDT 3,412.50 -0.8%
Total Equity 100.0035 USDT | Today PnL +0.0035 | System Connected
```

## Left Rail

Left rail is strategy-focused.

Sections:

### Asset Allocation

Small horizontal allocation bars:

- USDT
- BTC
- optional future assets

Show:

- percentage
- balance
- color-coded asset chips

### Active Strategies

Strategy cards:

- EMA Scalper Pro
- Trend Follower v2
- Mean Revert
- Arbitrage Spike

Each card should include:

- Strategy name.
- Symbol and interval.
- Status badge:
  - Running
  - Paused
  - Blocked
- Trades count.
- Win rate.
- 24h PnL.
- Risk level.
- Action:
  - Pause for running strategies.
  - Resume for paused strategies.

Important:

- Use `Strategies`, not `Bots`, in final Meridian language.
- Do not show manual order placement.

## Main Workspace

Default Dashboard main workspace:

### Chart Header

Show:

- Symbol: `BTCUSDT`
- Last price.
- 24h change.
- Volume.
- Timeframe buttons:
  - 1m
  - 5m
  - 15m
  - 1h
  - 4h
  - 1d
- Active overlays:
  - EMA 9/21
  - Signals
  - Fills

### Main Chart

The chart should show:

- Candlesticks.
- Volume bars.
- EMA lines.
- Buy/sell signal markers.
- Fill markers.
- Tooltip on hover.

Recommended library:

- `lightweight-charts`

For the first implementation:

- Use available live trade/dashboard data if candles are not available yet.
- If candle API is missing, create an internal chart adapter with mock candles temporarily, clearly marked as temporary in code.

Chart should not look decorative. It should feel like the central trading surface.

## Right Panel

Right panel contains fast operator context.

### Risk Exposure

Show:

- Volatility index.
- Max drawdown.
- Kill switch state.
- Risk status:
  - Safe
  - Warning
  - Blocked

### Order Book

Show:

- Ask rows in red.
- Bid rows in green.
- Spread.
- Amount and total columns.

If no real order book API exists yet:

- Use existing market stream/trade data for placeholder.
- Mark implementation as temporary.
- Do not pretend it is real depth if it is not wired.

### Recent Trades

Show recent market trades:

- Side.
- Quantity.
- Price.
- Time.

### Open Position

Show:

- Symbol.
- Side.
- Size.
- Entry.
- Mark.
- Unrealized PnL.
- Take profit / stop loss if available later.

For Meridian v1, this is read-only.

### Critical Controls

Controls:

- Emergency stop / engage kill switch.
- Pause selected strategy.
- Resume selected strategy.

Rules:

- All write actions require a confirmation modal.
- No direct order placement.
- No buy/sell buttons.

## Bottom Panel

Bottom panel should behave like a terminal log/table area.

Tabs:

- Live Execution Log
- Risk Events
- Orders
- Fills
- System Events

Default tab: Live Execution Log.

Columns:

- Timestamp
- Pair/Symbol
- Side/Event
- Price
- Size
- Fee
- Slippage
- Realized PnL
- Status

Statuses:

- FILLED
- PARTIAL
- CANCELED
- UNKNOWN
- REJECTED
- RISK_BLOCKED

Use compact rows and sticky headers.

## Data Mapping To Current APIs

Use these existing endpoints:

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

## Required Frontend Files

Suggested structure:

```txt
apps/web/src/
  app/
    App.tsx
    AppShell.tsx
  lib/
    api-client.ts
    format.ts
  components/
    terminal/
      TopBar.tsx
      Sidebar.tsx
      MetricBadge.tsx
      StatusBadge.tsx
      DataTable.tsx
      ConfirmDialog.tsx
    market/
      MarketChart.tsx
      OrderBookPanel.tsx
      RecentTradesPanel.tsx
    trading/
      ExecutionLog.tsx
      OrdersTable.tsx
      FillsTable.tsx
      PositionsPanel.tsx
    risk/
      RiskExposurePanel.tsx
      CriticalControls.tsx
    strategies/
      StrategyCard.tsx
      StrategyList.tsx
  features/
    dashboard/
      DashboardPage.tsx
    strategies/
      StrategiesPage.tsx
    analytics/
      AnalyticsPage.tsx
    settings/
      SettingsPage.tsx
  styles/
    global.css
```

Keep components small and readable.

## First Implementation Slice

Build this first:

1. `api-client.ts`
2. App shell:
   - top bar
   - left rail
   - main workspace
   - right panel
   - bottom panel
3. Dashboard page with:
   - ticker/status top bar
   - strategy cards
   - chart panel
   - risk panel
   - recent trades
   - execution log
4. Confirmation modal for kill switch, but wire it only after read UI is stable.

## Styling Rules

Use a custom CSS design system in `global.css`.

Recommended tokens:

```css
:root {
  --bg: #080c0f;
  --surface-1: #0d1216;
  --surface-2: #11181d;
  --surface-3: #172027;
  --border: #22303a;
  --text: #e6edf3;
  --muted: #8b9aa7;
  --faint: #5d6b76;
  --green: #00c896;
  --red: #ff4d6d;
  --amber: #f2b84b;
  --blue: #4ea1ff;
  --purple: #9b7cff;
}
```

Typography:

- App font: Inter or system sans.
- Numeric font: use tabular numerals via CSS.
- Do not use huge headings.
- Tables should use compact text.

Panel style:

- Border: `1px solid var(--border)`.
- Radius: `6px` or `8px`.
- Background: `var(--surface-1)` or `var(--surface-2)`.
- Avoid heavy shadows.

## Interaction Rules

- Sidebar strategy cards are selectable.
- Timeframe buttons update chart state locally first.
- Table tabs switch bottom panel.
- Kill switch opens confirmation modal.
- Pause/resume opens confirmation modal.
- Loading states should be skeleton rows, not spinners everywhere.
- Error states should show compact warning bars.

## Coding Agent Prompt

Give this to the frontend coding agent:

```txt
We are starting Meridian frontend implementation using the approved terminal-style mockup direction.

Read:
- docs/frontend-terminal-mockup.md
- docs/frontend-design-brief.md
- docs/current-state.md
- docs/implementation-plan.md
- apps/web/src/app/App.tsx
- apps/web/src/styles/global.css
- apps/api/src/app/register-routes.ts
- apps/api/src/features/**

Goal:
Convert the current temporary frontend into a professional dark trading operations terminal for Meridian.

Visual target:
- Similar to a real automated trading/bot monitoring terminal.
- Dense dark UI.
- Left strategy rail.
- Central chart workspace.
- Right risk/order-book panel.
- Bottom execution log.
- Top market/account/system status bar.
- No generic AI dashboard look.
- No landing page.
- No direct order placement UI.

Working agreement:
- The user will code the React implementation unless they explicitly ask Codex to code.
- Guide with exact files, component names, and snippets.
- CSS polish can be handled by Codex when requested.
- Keep write actions guarded by confirmation modals.

First implementation task:
Create the typed API client and terminal component skeleton.

Files to create:
- apps/web/src/lib/api-client.ts
- apps/web/src/lib/format.ts
- apps/web/src/app/AppShell.tsx
- apps/web/src/components/terminal/TopBar.tsx
- apps/web/src/components/terminal/Sidebar.tsx
- apps/web/src/components/terminal/StatusBadge.tsx
- apps/web/src/features/dashboard/DashboardPage.tsx

Files to update:
- apps/web/src/app/App.tsx
- apps/web/src/styles/global.css

API client functions:
- getDashboard()
- getTradingState()
- getOrders(limit?)
- getFills(limit?)
- getPositions()
- getRiskState()
- getRiskEvents(limit?)
- getAccountSummary()
- engageKillSwitch(reason)
- pauseStrategy(strategyId, reason)
- resumeStrategy(strategyId, reason)

Dashboard skeleton should include:
- top bar with brand, tabs, tickers, account summary, system status
- left sidebar with asset allocation and strategy cards
- center chart panel placeholder
- right panel with risk exposure, order book placeholder, recent trades, open position, critical controls
- bottom panel with execution log table

Rules:
- Keep decimal values as strings.
- Use fetch only for now.
- Use React Query where useful because it is already installed.
- Do not add new UI libraries.
- Do not add direct Buy/Sell manual trading buttons.
- If order book/candles are not API-backed yet, mark the component data as temporary and isolate it clearly.

After implementation, run:
pnpm --filter @meridian/web typecheck
```

## Acceptance For First Slice

- Frontend resembles the terminal layout described above.
- No direct order placement UI exists.
- API client is typed.
- Dashboard compiles.
- `pnpm --filter @meridian/web typecheck` passes.
- Temporary mock-only data is isolated and clearly named.

