# Phase 3.5 Verification

Status on 2026-10-09: prototype verification checkpoint complete under the user's revised scope; full Phase 3.5 acceptance remains pending. The user explicitly chose to finish prototype checks and keep the 48-hour gate pending.

## Latest Prototype Checkpoint

- Regression: 1,118 passing tests across 130 files, including six isolated PostgreSQL risk/allocation tests and eight disposable execution tests. Core/DB/engine/executor builds pass.
- Explicit opt-in Testnet allocation is implemented across engine and executor: immutable audited policy/account binding, saved wallet backing baseline, fresh-ledger/engaged-kill initialization, fee-aware managed inventory, foreign-order rejection and fail-closed funding/configuration drift. Default full-wallet valuation is unchanged. Setup and limitations: `risk-engine.md`.
- Real risk-approved fill check passed at 2026-10-09 21:53:40 Dubai time. An actual closed Testnet candle triggered deterministic one-shot strategy signals through the live runner, Redis consumer, unchanged risk limits, write-ahead claim and signed order adapter. Two IOC LIMIT orders, each 0.0002 BTC and below 25 USDT, filled: BUY at 82714.01 (`fillcheck_-ZyvBs3a-aJqdmtIskpsMZZl4y`) and SELL at 82731.6 (`fillcheck_F9T4cMMMPnFJ-AKc0ikNLKaAZc`). Real user-data fills were persisted and reconciled with signed queries. Exchange-reported fees were zero; nonzero base/quote fee handling is covered by unit tests, not claimed as live fee evidence. Managed residual BTC zero, allocated equity 100.003518 USDT, own open orders zero. Proof: `logs/verification/fill-4b0f19c47a01490690ca.json`. This is not EMA performance or unattended acceptance.
- Fixed real kill-switch cancellation: native open-order responses contain extra fields, but the signed cancel API accepts only symbol/clientOrderId. Cancellation now projects those fields explicitly; regression coverage uses a full-shaped open-order DTO.
- Real Testnet kill-switch check: `mrd-check-1bbe1ec1a19d4aaabc669c32`, BTCUSDT LIMIT BUY 0.0002 at 82171.45 (16.43429 USDT). Kill engagement canceled it in 429 ms, persisted two real user-data updates with final state CANCELED, latched both disposable stores, emitted an alert and rejected a subsequent real Redis signal. One placement, no fills, no own open order. Proof: `logs/verification/mrd-check-1bbe1ec1a19d4aaabc669c32.json`.
- Earlier fixture IDs `mrd-check-d3eecfff8cca4129ac58bc97` and `mrd-check-ce4165f3dfed4fa5ad061127` failed verification while the old cancellation implementation was still compiled. Cleanup canceled both; independent signed queries confirmed CANCELED, executed quantity zero and no open order. Each fixture was individually bounded to 0.0002 BTC and 25 USDT. They are not successful verification results.
- Clean candle replay: `sessions/verification/candle-parity-2be67243-1556-44e0-85f9-11e63d6f90b1`. Captured 100 actual REST warm-up candles plus one closed 15m public WebSocket candle, then replayed all 101 candles against 28 separately saved live-runner decisions. All signals matched. Uses independent simulated execution on both sides, EMA 2/3, zero fees/slippage; this is not real trading/account parity. Capture completed 2026-10-09 21:15 Dubai time.
- Improved read-only submission recovery: immutable DB identity is checked before expiry/new-order risk checks. Already-claimed/sent orders are queried, never resent; accepted orders can be confirmed even after signal expiry or kill engagement. Query failures/not-found/conflicts preserve pending uncertainty. Actual worker-death tests verify post-send recovery and claim-before-send uncertainty after TTL expiry; eight disposable integration tests pass.
- REST account-trade catch-up after executor downtime is implemented and tested with mocked Binance/account-trade clients. Startup/reconnect reconciliation can query `/api/v3/myTrades` for matched/terminal exchange order IDs, convert missed trades into fee-aware `order_fills`, dedupe duplicate trade identity and avoid moving order state backwards through the existing monotonic event-time guard.
- Follow-up: bounded live missed-fill catch-up fixture `missfill-739454811c0f4f2fb3c2` passed. It placed two BTCUSDT IOC Testnet orders, each 0.0002 BTC and below 25 USDT, with user-data persistence intentionally skipped. Reconciliation found both local non-terminal orders as terminal-on-exchange; REST `/api/v3/myTrades` fetched one trade per order and persisted both fills into `order_fills`. BUY fill: trade `211165`, price 82835.62, quantity 0.0002. SELL fill: trade `211166`, price 82835.61, quantity 0.0002. Own open orders ended at zero. Proof: `apps/executor/logs/verification/missfill-739454811c0f4f2fb3c2.json`. This is bounded catch-up evidence, not unattended acceptance.
- Read-only full-account risk preflight correctly rejected an unpriceable Testnet faucet asset. Nothing was assigned a fabricated price. The separately scoped, audited allocation now enables bounded strategy/risk fill verification without valuing the entire wallet or relaxing risk limits. This does not approve unattended full-wallet trading.

The initial fill fixture used separate BUY/SELL strategy IDs and did not run the
post-SELL daily-PnL monitor; its pass is bounded execution/persistence evidence,
not proof of strategy-specific closing cost basis. The fixture now uses the same
strategy ID for both legs and verifies final realized PnL and the risk monitor.
The follow-up `fill-2ec9e663344e4a3ba762` filled 0.0002 BTC BUY at 82686.01
and SELL at 82678.47 (zero fees), reached successful post-fill risk monitoring,
then failed only in the final SQL evidence export (`strategy_id` is on orders,
not order_fills). Its artifact remains honestly labeled `failed-cleaned-up`:
`logs/verification/fill-2ec9e663344e4a3ba762.json`. Cleanup was verified; this
is not an additional clean fixture pass. The export now uses the existing
`RiskRepository.listFills` join, verified against real PostgreSQL with a persisted
fill/strategy identity. No further live orders were placed after fixing export;
the final fixture version has not been rerun end to end. Both real round trips
finished flat; together they changed Testnet USDT by +0.00201. All four fill-check
orders were independently queried as FILLED and BTCUSDT had no open orders.

The earlier cancellation fixture is operator-controlled setup, not a risk-approved strategy entry. Its three orders closed with zero fills. Existing application services, shared database/Redis state, `.env` and soak files were untouched. All disposable containers/workers were removed; no background trading was started.

## Verified Evidence

- Regression: 1,068 passing tests across 127 files.
- Six opt-in disposable Testcontainers Redis/Timescale tests apply real migrations and verify stream consumer groups, write-ahead storage, simulated fee-aware fills through the production user-data handler, and fill deduplication.
- Actual worker process death before claim and after placement/before ACK: restart produces exactly one simulated exchange placement and clears pending messages.
- Death after claim/before send: restart retains UNKNOWN and the pending message without a blind resend. This is safety evidence, not automatic no-loss recovery.
- Actual Redis shutdown: zero new orders, durable kill latch, cancellation and alert calls within seconds. Exchange cancellation is mocked. Actual PostgreSQL insert failure: zero orders and no ACK.
- Parity: deterministic recorded-format candles match; the longest contiguous segment derived from the real trade recording has 14 closed 15m bars and three matching signals. Both sides use independent simulated brokers with identical next-open fills and zero fees/slippage. EMA periods are 2/3. Trades are aggregated by event time and trade-ID ordering; boundary buckets and recording gaps are excluded. This is not recorded exchange-kline/live-execution parity.
- Real Testnet authentication: signed open-order read and user-data state OPEN; no existing BTCUSDT open orders.
- Authorized real Testnet smoke: one LIMIT BUY, quantity 0.0002 BTC, price 81136.28, notional 16.227256 USDT, client ID `meridian-smoke-1791485112044`. Placement/query NEW, cancellation CANCELED, own order absent from open orders. No real fill was observed or claimed.

Existing services and soak recording were not modified. Temporary containers and child processes are cleaned up. No production trading and no long unattended run were started.

## Repeatable Local Checks

Build the worker before running process-kill tests; the child fixture imports compiled executor code. Docker must be available. Tests create and destroy only their own containers.

```powershell
node node_modules/typescript/bin/tsc -p packages/db/tsconfig.json
node node_modules/typescript/bin/tsc -p apps/executor/tsconfig.json
$env:RUN_EXECUTION_INTEGRATION = '1'
$env:PARITY_TRADE_SESSION = 'sessions/soak/phase-1-5-events.ndjson'
$env:PARITY_CANDLE_SESSION = 'sessions/verification/candle-parity-2be67243-1556-44e0-85f9-11e63d6f90b1'
node node_modules/vitest/vitest.mjs run apps/executor/src/execution-loop.integration.test.ts tests/phase-3-5/strategy-parity.test.mjs packages/binance-client/src/rest/bounded-order-check.test.ts
```

The trade-derived and captured-candle cases skip without their respective `PARITY_*_SESSION` variables; the deterministic case always runs. Infrastructure tests skip without `RUN_EXECUTION_INTEGRATION=1`. The optional isolated-schema PostgreSQL risk tests use `RISK_TEST_DATABASE_URL`; they are separate from disposable-container verification.

Capture a fresh public candle session without credentials/orders. It uses 100 closed REST candles for warm-up and waits up to 16 minutes for one actual closed WebSocket candle. The generated manifest records the provenance; do not call the warm-up bars WebSocket captures.

```powershell
node node_modules/typescript/bin/tsc -p apps/engine/tsconfig.json
node node_modules/typescript/bin/tsc -p apps/backtest-worker/tsconfig.json
node tests/phase-3-5/capture-candle-session.mjs
```

The bounded live kill-switch fixture creates one real Testnet order and requires explicit authorization before rerunning. It preflights exchange filters, records its ID before placement, persists real order events into disposable storage, scopes cancellation to that ID and verifies a post-kill signal rejection. There is a cleanup fallback and an explicit reconciliation warning if cleanup cannot be verified.

```powershell
node node_modules/typescript/bin/tsc -p apps/executor/tsconfig.json
node apps/executor/src/testing/live-kill-switch.mjs --confirm-bounded-testnet-check
```

Verification artifacts live under ignored `sessions/` and `logs/`; they are local evidence, not committed fixtures. A fresh checkout must generate its own capture and set its path before opting into those parity cases.

The bounded fill fixture requires explicit authorization before rerunning. It
creates at most two actual IOC orders, caps each at 0.0002 BTC and 25 USDT,
initializes a disposable audited 100-USDT portfolio, validates native filters,
waits for BUY reservation expiry and sells only managed inventory. It exports
fill evidence before teardown, cancels only its own IDs and reports uncertain
cleanup. Base fees/lot steps can leave dust; no extra order or pre-existing wallet
inventory is used to force a flat result. Never substitute this for a 48h run.

```powershell
node node_modules/typescript/bin/tsc -p packages/core/tsconfig.json
node node_modules/typescript/bin/tsc -p packages/db/tsconfig.json
node node_modules/typescript/bin/tsc -p apps/engine/tsconfig.json
node node_modules/typescript/bin/tsc -p apps/executor/tsconfig.json
node apps/executor/src/testing/live-fill-check.mjs --confirm-bounded-testnet-fills
```

The bounded missed-fill catch-up fixture creates at most two actual IOC orders,
caps each at 0.0002 BTC and 25 USDT, intentionally skips user-data persistence,
then verifies reconciliation plus REST `/myTrades` can recover the fills. It is
not a substitute for the unattended 48h run.

```powershell
pnpm --filter @meridian/executor verify:missed-fill-catch-up -- --confirm-bounded-testnet-missed-fill-catch-up
```

The Testnet smoke requires explicit authorization before rerunning, since it creates a real order:

```powershell
node node_modules/typescript/bin/tsc -p packages/binance-client/tsconfig.json
node packages/binance-client/dist/trading-order-smoke.js --symbol BTCUSDT --quantity 0.0002 --confirm-testnet-order
```

The smoke enforces BTCUSDT only, quantity at most 0.0002 BTC and notional at most 25 USDT before placement. It never resends a placement, queries uncertain outcomes, cancels only its own client ID, verifies terminal state and checks that ID is absent from open orders. Unverifiable cleanup explicitly requires operator reconciliation. This command is not the executable strategy/risk pipeline and does not test full exchange-metadata preflight or portfolio risk gating.

## Open Acceptance Work

- Resolve the durable-claim/before-network-send liveness boundary without unsafe retries; current UNKNOWN reservations require exchange reconciliation/operator investigation.
- Clean candle-session replay is now verified under identical simulated execution assumptions. Longer sessions and real account/fill parity remain stronger follow-up evidence.
- Real kill-switch cancellation, user-data persistence, risk-approved allocated strategy BUY/SELL fills, and REST missed-fill catch-up are verified in bounded fixtures. Allocated Testnet backing rebaseline has an audited operator command. Longer real strategy/account parity, full-wallet valuation/opening-inventory handling and unattended evidence remain follow-ups before unattended trading. The shared application has not been activated with the opt-in allocation policy.
- The planned 48h+ unattended Testnet run has not happened. The user authorized a bounded short check and said 48h was too long; a short pass must not be labeled a 48h pass.
- Produce the planned screen recording of trading and kill-switch activation.
