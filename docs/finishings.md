# Meridian Finishings

Use this file for issues, gaps, polish work, verification tasks, and risks found while the prototype is being built in another chat.

The goal is to keep prototype momentum high while still preserving a serious finishing pass before calling any phase truly resume-grade.

## Review Rule

When progress is reported:

1. Compare it against `docs/implementation-plan.md`.
2. Check whether the implementation is complete, tested, and safe enough for the current phase.
3. Do not block prototype flow for tiny formatting issues.
4. Add real gaps here if they affect correctness, reliability, security, observability, maintainability, or resume/demo quality.

## Open Items

- [ ] **`reliability` / `prototype-gap`: Extend risk valuation and operator rebaselining without weakening fail-closed behavior.**
  - Recorded: 2026-10-08. Phase 3.4 blocks unpriceable account assets, missing opening cost basis, and third-asset fees without historical conversion. Portfolio snapshots/fill replay are conservative but become expensive with many assets or a long fill history.
  - Acceptance: support explicit, audited opening inventory and Testnet-reset/cash-flow equity rebaselining; persist exact historical fee conversion and incremental accounting; improve snapshot collection without hiding stale data. Current unsupported inputs must remain blocked until their values are reliable. See `docs/risk-engine.md`.

- [ ] **`reliability` / `prototype-gap`: Add REST account-trade catch-up after executor downtime.**
  - Recorded: 2026-10-08. Phase 3.2 now persists live user-data execution reports into `order_fills` with fee/fee_asset and reconciles local order state on startup/reconnect by querying orders. This is enough for the current prototype lifecycle foundation, but it does not yet call Binance account trade history to backfill fills that were missed while the executor was offline.
  - Acceptance: after reconnect/startup, query recent account trades for affected symbols/orders, dedupe by trade/execution identity, persist fee-aware fills, and prove a missed-fill downtime scenario in tests.

- [ ] **`architecture` / `prototype-gap`: Replace Phase 3.1 adapter placeholders with full exchange-backed capabilities before unattended execution.**
  - Recorded: 2026-10-07; updated 2026-10-08. The Phase 3.1 adapter layer is intentionally narrow and locally tested, but it is not the final execution layer. A signed Binance account endpoint now exists and is wired into the live engine context, but the broader adapter layer still needs full exchange-metadata/filter preflight and final account/order capability coverage. The simulator gateway exposes order submission and fill processing but cancellation is unsupported because the current `SimBroker` has no cancel primitive. The backtest candle-feed `MarketDataSource` supports only the feed's current bounded `15m`/`1h` intervals.
  - This is acceptable for closing the shared-contract adapter work, but Phase 3.2 must not assume these adapters provide full lifecycle, reconciliation, or exchange-metadata behavior.
  - Acceptance: add real account/balance retrieval, exchange metadata/filter preflight, simulator cancellation/order-state support, and clear integration tests before unattended paper trading.

- [ ] **`prototype-gap` / `frontend`: Replace the mock Backtests Strategy Lab preview with API-backed data later.**
  - Recorded: 2026-10-05. `apps/web/src/features/backtests/BacktestPreview.tsx` is a temporary visual helper using static mock data to show Phase 2.4 progress before the real frontend/API integration exists.
  - It intentionally does not connect to the backend and should not be treated as the final Phase 4 backtest launcher/results UI.
  - Acceptance: replace static mock runs with API-backed saved-run list/show/report data, remove mock-only data, and wire loading/error/empty states through the real dashboard API.

- [ ] **`reliability` / `testing`: Worker-thread backtest jobs should settle when a worker exits cleanly without a message.**
  - Recorded: 2026-10-05. `runBacktestJobInWorker` resolves on `message`, `error`, and non-zero `exit`, but a worker that exits with code `0` before posting a result can leave the returned promise pending forever.
  - This is acceptable for the current queue/worker foundation, but sweep execution should not be able to hang silently.
  - Acceptance: add a focused test for exit code `0` without a message and decide the behavior, for example return `{ ok: false, error: "Worker exited before sending a result" }`.

- [ ] **`architecture` / `prototype-gap`: Generalize prototype symbol configuration.**
  - Recorded: 2026-10-04. Phase 2.0 deliberately targets one symbol; keep the BTCUSDT prototype moving and revisit this after the vertical slice works end to end.
  - Replace the CLI's BTCUSDT-only restriction and the command's fixed BTC/USDT asset settings with validated symbol configuration. Resolve base/quote assets, tick size, quantity step size, and minimum notional from exchange metadata; do not infer assets by splitting symbol strings.
  - Make the monitoring dashboard/API stream selection and soak recording/log paths configurable rather than fixed to BTCUSDT and the Phase 1.5 session.
  - Acceptance: a second supported symbol can run through the same feed, strategy, broker, CLI, and monitoring code with correct assets and filters, without editing production source. Add focused tests for symbol selection, metadata validation, and asset isolation.
  - Fixed BTCUSDT test fixtures may remain; the finishing work concerns production restrictions and duplicated configuration.

- [ ] **`observability` / `prototype-gap`: Dashboard is useful for Phase 1.5 monitoring but is hard-coded to BTCUSDT soak paths.**
  - Recorded: 2026-10-05. The dashboard currently reads `market.trade.BTCUSDT`, `sessions/soak/phase-1-5-events.ndjson`, and fixed soak log paths. This is acceptable for the prototype monitor, but not for the eventual Phase 4 dashboard.
  - Keep moving, but later make symbol, stream names, recording path, and soak metadata configurable from API/env or DB state.
  - Acceptance: dashboard can monitor another symbol/session without source edits.

- [ ] **`reliability` / `observability`: Add Redis Streams retention and memory policy before long unattended runs.**
  - Recorded: 2026-10-05. During the Phase 1.5 soak, `market.trade.BTCUSDT` grows without trimming and Redis reports `maxmemory:0` with `maxmemory_policy:noeviction`. Memory growth is expected because every market event is retained in Redis plus persisted to Timescale and NDJSON.
  - Decide a retention policy per stream, for example `XADD ... MAXLEN ~ {N}` for hot dashboard/consumer windows plus Timescale/NDJSON as durable history, or time-window trimming through a maintenance task.
  - Acceptance: stream memory stays bounded during a multi-hour soak; dashboard shows stream length/memory trend; consumer-group safety is preserved or documented when trimming pending entries.

## Resolved Items

- [x] **`architecture` / `prototype-gap`: Replace JSON-bytes EventCodec implementation with generated Protobuf/buf output.**
  - Recorded: 2026-10-08. Phase 3.3 engine consumers parsed market payloads through the shared `EventCodec<MarketEventMessage>` boundary, but the concrete codec implementation was still the JSON-bytes debug codec.
  - Resolved: added the market-event `.proto` schema, generated-style protobuf wire encode/decode, `marketEventProtobufCodec`, and default protobuf wiring in both ingestor and engine. JSON remains available as an explicit debug/legacy codec, and the engine keeps a legacy JSON payload fallback.
  - Result: market stream payloads are protobuf binary by default. Verified 2026-10-08 with `@meridian/proto` typecheck/build/tests, `@meridian/ingestor` typecheck/build/tests, and `@meridian/engine` typecheck/build/tests.

- [x] **`architecture` / `prototype-gap`: Wire live StrategyContext positions and balances from durable/account state.**
  - Recorded: 2026-10-08. Phase 3.3 runtime wiring originally started a real engine process and provided the `StrategyContext` facade, but the executable engine still fell back to zero/default positions and balances unless injected callbacks were provided.
  - Resolved: added signed Testnet account balance snapshots to the Binance trading client, added engine Postgres runtime access to persisted `order_fills`, wired `createLiveFillReader` + `createLiveAccountState` into the executable engine path, and refreshed that state before strategy startup/market execution.
  - Result: live strategies now see positions derived from persisted fills and balances from authenticated account snapshots in the real engine main path. Verified 2026-10-08 with `@meridian/binance-client` typecheck/build/tests and `@meridian/engine` typecheck/build/tests.

- [x] **`correctness` / `testing`: Restore green workspace-package build/typecheck state after source/dist drift.**
  - Recorded: 2026-10-05. `@meridian/ingestor` had failed typecheck/test because it resolved stale built declarations from `@meridian/proto` and `@meridian/config`.
  - Resolved: ran `pnpm install`, rebuilt `@meridian/proto` and `@meridian/config`, then verified `pnpm --filter @meridian/ingestor typecheck` and `pnpm --filter @meridian/ingestor test`.
  - Result: ingestor typecheck passed; ingestor tests passed with 72 tests across 27 files.

- [x] **`correctness` / `prototype-gap`: Dashboard API package must typecheck from a clean install/build.**
  - Recorded: 2026-10-05. `@meridian/api` had previously failed with missing dependency/type and strict TypeScript errors.
  - Resolved: after `pnpm install`, `pnpm --filter @meridian/api typecheck` passed without code changes.

- [x] **`docs`: Refresh the next-chat prompt in `docs/current-state.md` before handing off again.**
  - Recorded: 2026-10-05. The top handoff prompt still said to continue from Phase 2.1, while the state summary had already moved beyond that.
  - Resolved: verified on 2026-10-08 that the top handoff prompt now points to Phase 3.2 order lifecycle, matches the implementation-plan phase status, and keeps the soak monitor paused unless explicitly restarted.

## Categories

Use these labels when adding items:

- `correctness`
- `security`
- `testing`
- `observability`
- `docs`
- `architecture`
- `prototype-gap`
- `resume-polish`
