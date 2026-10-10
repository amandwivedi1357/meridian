# Current State

Use this note as a human-friendly mirror of `docs/current-state.md`.

Last vault refresh: 2026-10-09.

## Agreement

- User writes implementation code unless explicitly asking Codex to code.
- Codex guides with file names, code direction, and explanations.
- Codex writes or updates tests for new behavior.
- Codex updates progress docs when meaningful work is complete.
- Explanations can be in Hinglish.

## Verified Baseline

Latest known baseline:

```powershell
pnpm install
pnpm --filter @meridian/db build
pnpm --filter @meridian/binance-client build
pnpm --filter @meridian/executor build
pnpm --filter @meridian/db typecheck
pnpm --filter @meridian/db test
pnpm --filter @meridian/proto typecheck
pnpm --filter @meridian/proto test
pnpm --filter @meridian/ingestor typecheck
pnpm --filter @meridian/ingestor test
pnpm --filter @meridian/binance-client typecheck
pnpm --filter @meridian/binance-client test
pnpm --filter @meridian/engine typecheck
pnpm --filter @meridian/engine test
pnpm --filter @meridian/executor typecheck
pnpm --filter @meridian/executor test
```

Latest documented expected results:

- `@meridian/db`: typecheck passes; tests pass with 39 tests across 5 files
- `@meridian/proto`: typecheck/build/tests pass with 5 tests
- `@meridian/ingestor`: typecheck/build/tests pass with 72 tests across 27 files
- `@meridian/binance-client`: typecheck/build/tests pass with 301 tests across 26 files
- `@meridian/engine`: typecheck/build/tests pass with 37 tests across 11 files
- `@meridian/executor`: typecheck passes; normal tests pass with 125 tests and 11 skipped integration tests
- opt-in `RUN_EXECUTION_INTEGRATION=1` execution-loop integration passes after building executor dist

## Next Work

Continue remaining Phase 3.5 acceptance work.

Current handoff summary:

- Phase 3.3 is complete in local code/tests.
- Phase 3.4 is locally complete.
- Phase 3.5 is partially verified, not complete.
- Engine consumes market streams through protobuf-backed `EventCodec`.
- Ingestor publishes protobuf market payloads by default.
- JSON codec remains available for debug/legacy fallback.
- Engine runs strategies through the shared interface.
- Live strategy context gets positions from persisted `order_fills`.
- Live strategy context gets balances from signed Binance Spot Testnet account snapshots.
- Engine publishes expiring `Signal` records.
- Executor consumes signals, validates, runs the risk engine, records write-ahead orders, and sends through the Testnet placement path.
- Risk engine has local checks for notional, quantity, position/exposure, open orders, orders/minute, daily loss, drawdown, market freshness, price sanity, kill switch, and persisted risk rejection events.
- Disposable execution-loop integration verifies simulated signal/fill, process-kill recovery, claim-before-send ambiguity behavior, write-ahead fail-closed behavior, and Redis outage fail-closed behavior.

Important caveat:

- This is still not production-ready live trading.
- Remaining open work includes clean recorded-kline/live-signal parity, actual fill flow, real kill-switch cancellation, 48h unattended Testnet verification, and the planned screen recording.

Related:

- [[03 Phase Roadmap]]
- [[25 Execution and Risk]]
- [[92 Resume Story]]
