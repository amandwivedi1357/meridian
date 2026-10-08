# Current State

Use this note as a human-friendly mirror of `docs/current-state.md`.

Last vault refresh: 2026-10-08.

## Agreement

- User writes implementation code unless explicitly asking Codex to code.
- Codex guides with file names, code direction, and explanations.
- Codex writes or updates tests for new behavior.
- Codex updates progress docs when meaningful work is complete.
- Explanations can be in Hinglish.

## Verified Baseline

Latest known baseline:

```powershell
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

- `@meridian/proto`: typecheck/build/tests pass with 5 tests
- `@meridian/ingestor`: typecheck/build/tests pass with 72 tests across 27 files
- `@meridian/binance-client`: typecheck/build/tests pass with 291 tests across 25 files
- `@meridian/engine`: typecheck/build/tests pass with 37 tests across 11 files
- `@meridian/executor`: typecheck/tests pass with 52 tests across 12 files

## Next Work

Start Phase 3.4: risk engine.

Current handoff summary:

- Phase 3.3 is complete in local code/tests.
- Engine consumes market streams through protobuf-backed `EventCodec`.
- Ingestor publishes protobuf market payloads by default.
- JSON codec remains available for debug/legacy fallback.
- Engine runs strategies through the shared interface.
- Live strategy context gets positions from persisted `order_fills`.
- Live strategy context gets balances from signed Binance Spot Testnet account snapshots.
- Engine publishes expiring `Signal` records.
- Executor consumes signals, validates, runs a risk hook, records write-ahead orders, and sends through the Testnet placement path.

Important caveat:

- This is still not production-ready live trading.
- Phase 3.4 risk engine, kill switch, persisted risk events, exchange metadata/filter preflight, chaos tests, and 48h unattended Testnet verification are still pending.

Related:

- [[03 Phase Roadmap]]
- [[25 Execution and Risk]]
- [[92 Resume Story]]

