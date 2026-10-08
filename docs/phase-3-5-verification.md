# Phase 3.5 Verification

Status on 2026-10-08: partially verified, not accepted as complete.

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
node node_modules/vitest/vitest.mjs run apps/executor/src/execution-loop.integration.test.ts tests/phase-3-5/strategy-parity.test.mjs packages/binance-client/src/rest/bounded-order-check.test.ts
```

The real-recording parity case skips without `PARITY_TRADE_SESSION`; the deterministic case always runs. Infrastructure tests skip without `RUN_EXECUTION_INTEGRATION=1`. The optional isolated-schema PostgreSQL risk tests use `RISK_TEST_DATABASE_URL`; they are separate from disposable-container verification.

The Testnet smoke requires explicit authorization before rerunning, since it creates a real order:

```powershell
node node_modules/typescript/bin/tsc -p packages/binance-client/tsconfig.json
node packages/binance-client/dist/trading-order-smoke.js --symbol BTCUSDT --quantity 0.0002 --confirm-testnet-order
```

The smoke enforces BTCUSDT only, quantity at most 0.0002 BTC and notional at most 25 USDT before placement. It never resends a placement, queries uncertain outcomes, cancels only its own client ID, verifies terminal state and checks that ID is absent from open orders. Unverifiable cleanup explicitly requires operator reconciliation. This command is not the executable strategy/risk pipeline and does not test full exchange-metadata preflight or portfolio risk gating.

## Open Acceptance Work

- Resolve the durable-claim/before-network-send liveness boundary without unsafe retries; current UNKNOWN reservations require exchange reconciliation/operator investigation.
- Record a clean live candle session and replay against captured live strategy signals with matching account/execution assumptions.
- Verify actual strategy/risk/executor/user-data fill flow and real kill-switch cancellation, not just isolated adapters and mocked fills/cancellations.
- The planned 48h+ unattended Testnet run has not happened. The user authorized a bounded short check and said 48h was too long; a short pass must not be labeled a 48h pass.
- Produce the planned screen recording of trading and kill-switch activation.
