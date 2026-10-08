# Phase 3.4 Risk Controls

Implemented locally on 2026-10-08. Live kill-switch timing, full order/fill integration,
crash tests, and the 48-hour Testnet run remain Phase 3.5 verification tasks.

## Execution Rules

The executable executor uses `createRiskEngine`, not only the earlier basic risk
hook. It checks the durable/Redis kill switch, account and market freshness,
notional, quantity, projected symbol position/exposure, global exposure, global
open-order count, per-strategy sliding-minute order rate, UTC daily realized loss
(global and per strategy), peak-based equity drawdown, and deviation from book mid.
A final pre-submit check refreshes risk state after persistence. Expiry is checked
again after that asynchronous check. Already in-flight exchange requests cannot be
retracted by a newly engaged switch; cancellation/reconciliation handles them.

Approvals reserve capacity in PostgreSQL under a shared transaction advisory lock.
The one-minute rate budget counts reservations, including approvals that never
reach the exchange; this is deliberately conservative. Uncertain/non-terminal
orders retain reservations beyond signal expiry. Open exchange orders and durable
reservations may overlap and conservatively consume capacity twice. Do not delete
uncertain records merely to make limits pass.

Rejected, malformed, unsupported and expired signal messages are recorded in
`risk_events` before Redis ACK. If auditing fails, the message stays pending.
Final submission-check failures are also audited and never authorize a send.

## Kill Switch

Migration `005_risk_controls_schema` initializes the global switch **engaged**.
Executor startup applies migrations and checks the switch. Starting it can cancel
existing Testnet open orders while the switch is engaged. It never automatically
resets the switch or enables trading.

Both PostgreSQL and Redis must explicitly report an inactive switch. A missing,
malformed, timed-out or unreadable Redis flag, or unreadable DB state, blocks new
orders and latches engagement where storage remains available. Redis recovery or
a Redis wipe does not silently resume trading. Engagement is recorded atomically
with an audit entry; cancellation retries continue through the service safety tick,
including idle markets and failed signal reads. Daily-loss/drawdown breakers also
run periodically without requiring a new signal.

Alerts go to structured error logs, PostgreSQL `risk_events`, and the bounded Redis
`alerts` stream when Redis is reachable. Telegram/Discord delivery and dashboard
controls are later phases. Cancellation failures remain visible and retryable.

## Operator Commands

Configure a private random `MERIDIAN_RISK_ADMIN_TOKEN` of at least 32 characters in
the ignored root `.env`. Supply the matching `MERIDIAN_RISK_CONTROL_TOKEN` in the
operator shell. Never put credentials in command arguments, chat, or Git. The CLI
loads root `.env` and checks the token before constructing trading clients.

From the repository root, after building the executor:

```powershell
node apps/executor/dist/risk-control-cli.js engage --confirm-testnet-control
node apps/executor/dist/risk-control-cli.js reset --confirm-testnet-control
```

`engage` cancels Testnet open orders. `reset` explicitly authenticates the operator,
updates Redis, and commits the DB reset plus audit/event records. It does not clear
losses, equity peaks, unknown orders, or other breached limits. A continuing breach
will immediately engage the switch again. Do not run these commands as a read-only
smoke test. API authentication/roles will be added in Phase 4.

## Configuration

See `.env.example` for conservative defaults. Notional, exposure, equity and loss
use `EXECUTOR_RISK_QUOTE_ASSET` (default `USDT`). Drawdown and price deviation are
fractions, not percentage numbers: `0.1` means 10%. UTC is the daily-loss boundary.
All account base holdings, including pre-existing Testnet balances, count toward
exposure; choose limits deliberately before activation.

`EXECUTOR_RISK_SYMBOLS` is a comma-separated symbol allowlist. These symbols must
trade against the configured quote asset. Per-symbol limits accept JSON overrides:

```json
{ "ETHUSDT": { "maxQuantity": "0.1", "maxPosition": "1", "maxExposure": "300" } }
```

`EXECUTOR_STRATEGY_RISK_LIMITS` accepts, for example:

```json
{ "ema": { "ordersPerMinute": 2, "dailyLoss": "20" } }
```

Decimal values must be strings; the order-rate value is an integer. Invalid or
unknown configuration fields fail startup. Equity peaks survive process restarts;
changing quote currency against an existing peak fails closed.

## Safe Limitations

Account equity uses direct or inverse exchange-metadata-backed quote pairs.
Missing prices or balances block trading rather than silently ignoring assets.
Snapshots are stamped before requests, so slow collection cannot appear fresh.
Pending BUY quantities are exposure, not inventory available for SELL orders.

Daily realized PnL reconstructs per-strategy cost basis from persisted fills using
Decimal arithmetic, including base/quote fees and earlier-day inventory. Missing
opening cost basis or third-asset fees without historical valuation block trading.
REST missed-fill catch-up, reviewed Testnet-reset/equity rebaselining, and more
efficient persisted accounting are tracked in `finishings.md`. Deposits, withdrawals
or exchange resets can conservatively trip drawdown; never blindly clear peaks.

## Verification

Unit tests use mocked exchange transports. Opt-in PostgreSQL integration tests
create a unique isolated schema and remove only that schema afterwards:

```powershell
$env:RISK_TEST_DATABASE_URL='postgres://meridian:meridian@127.0.0.1:5432/meridian'
node node_modules/vitest/vitest.mjs run apps/executor/src/risk-storage.integration.test.ts
```

These verify atomic audit/state writes, rollback, cross-connection approval locking,
sliding-minute accounting, retained unknown-order reservations, and durable peaks.
They do not place/cancel exchange orders or change the application's Redis keys.
