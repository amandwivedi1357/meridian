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

- [x] **`reliability` / `prototype-check`: Define audited Testnet allocation and prove bounded risk-approved fills.**
  - Recorded: 2026-10-09. Real read-only full-account snapshot failed on a faucet asset with no priceable market. Other wallet holdings/limits may also block once that is resolved. The bounded live cancellation fixture verifies real order/user-data/kill adapters in isolated storage, not risk-approved strategy fills.
  - Resolved 2026-10-09 for the prototype: opt-in dedicated Testnet portfolio with immutable policy/API-key binding, audited initial funding/exclusions/backing baseline, fresh-ledger gate, fee-aware engine/risk state and drift/foreign-order rejection. A real risk-approved 0.0002 BTC BUY/SELL round trip passed with no own open orders or managed BTC remaining. Artifact: `logs/verification/fill-4b0f19c47a01490690ca.json`. Limits were not raised; default full-wallet valuation still blocks unpriceable assets. Shared application configuration was not changed. Full-wallet valuation and rebaselining remain below.

- [ ] **`reliability` / `acceptance-gate`: Complete unattended Phase 3.5 acceptance and demo evidence.**
  - Final bounded fixture version also awaits a clean authorized rerun: the second round trip passed trading/post-fill monitoring but failed only evidence export, now fixed and PostgreSQL-tested. Do not overwrite that failed artifact or call it a clean pass. No extra live orders were placed after the export fix.
  - The user explicitly kept the 48h gate pending. A bounded deterministic-strategy fill fixture does not prove EMA performance, long-running account parity, reconnect durability or 48h operation. Complete the full planned run and screen recording only with separate authorization and an appropriate prepared portfolio.
  - Clarification 2026-10-10: the 48h run and the screen recording are two different evidence types. The 48h unattended run should run mostly in the background and collect durable evidence through logs, DB rows, Redis/stream stats, order/fill/risk/audit tables, health snapshots, and a final summary. It should prove the system can stay alive across real wall-clock conditions: market streams, reconnects, rate limits, risk checks, reconciliation/catch-up, kill-switch fail-closed posture, Redis retention, DB persistence, and no duplicate/unbounded orders.
  - The screen recording does not need to be 48 hours long. It should be a short operator-style demo, likely 5-10 minutes, showing the already-running system state, recent orders/fills/risk events, Redis/DB evidence, and a kill-switch action with post-kill behavior. Until the Phase 4 dashboard exists, this can be terminal/log/dashboard-preview based rather than a polished UI demo.
  - This should mostly be CLI/operator workflow, not new trading feature work. Before starting, prepare an exact command checklist: start infra, start required services, confirm allocation/risk settings, run a short dry-run, set Redis retention/recording/log paths, define periodic snapshot commands, define final export queries, and define the kill-switch demo command. Add only small evidence-export/helper tooling if existing commands make the run hard to audit or repeat safely.

- [ ] **`reliability` / `prototype-gap`: Extend risk valuation and operator rebaselining without weakening fail-closed behavior.**
  - Recorded: 2026-10-08. Phase 3.4 blocks unpriceable account assets, missing opening cost basis, and third-asset fees without historical conversion. Portfolio snapshots/fill replay are conservative but become expensive with many assets or a long fill history.
  - Update 2026-10-10: allocated Testnet backing rebaseline is implemented as an authenticated operator command. It performs read-only exchange/account preflight, projects the current managed portfolio from persisted fills and managed open orders, and writes `testnet-allocation-rebaseline` audit details without changing the immutable policy, clearing ledger history, resetting equity peaks/losses, or placing orders.
  - Remaining acceptance: support explicit audited opening inventory for full-wallet mode, persist exact historical fee conversion and incremental accounting, and improve snapshot collection without hiding stale data. Current unsupported inputs must remain blocked until their values are reliable. See `docs/risk-engine.md`.

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

## Resolved Items

- [x] **`reliability` / `observability`: Add Redis Streams retention and memory policy before long unattended runs.**
  - Recorded: 2026-10-05. During the Phase 1.5 soak, `market.trade.BTCUSDT` grows without trimming and Redis reports `maxmemory:0` with `maxmemory_policy:noeviction`. Memory growth is expected because every market event is retained in Redis plus persisted to Timescale and NDJSON.
  - Resolved: added optional ingestor setting `INGESTOR_REDIS_STREAM_MAXLEN`. When configured, market event publishing uses Redis approximate trimming via `XADD <stream> MAXLEN ~ <N> * ...`, so Redis keeps a bounded hot window while Timescale/NDJSON remain the durable history.
  - Result: focused tests prove retention config parsing/rejection and XADD command shape with and without MAXLEN. Operational caveat: choose `N` large enough for expected consumer lag because Redis can trim old stream entries; pending-entry behavior during long soaks should be monitored with stream length/memory metrics.

- [x] **`reliability` / `acceptance-gate`: Resolve ambiguous submission liveness without blind resends.**
  - Recorded: 2026-10-09. A worker can die after the durable UNKNOWN claim but before network send; a missing exchange order cannot prove the old send was never accepted/in flight. Current behavior correctly keeps this uncertainty pending, including after TTL expiry. Accepted post-send orders are now recovered read-only before expiry/new-order risk checks.
  - Resolved: added an explicit authenticated operator-resolution path for unresolved `UNKNOWN` submissions. The resolver reads the local order, queries the exchange by `clientOrderId`, refuses to mutate state if the exchange order exists or the query fails, and only marks the local order `EXPIRED` with an audit-log record when the exchange returns not found. The executor still never blind-resends an ambiguous order.
  - Result: focused tests prove exchange-found and query-failed outcomes do not mutate local state, exchange-missing can be resolved as not-sent, the DB update is guarded by `state = 'UNKNOWN'` and `exchange_order_id IS NULL`, and the action writes `unknown-order-resolved-not-sent` to `audit_log`. This is an operator liveness policy, not a claim of automatic no-loss execution.

- [x] **`reliability` / `migration`: Add a forward-only migration for existing `order_fills` trade-id dedupe indexes.**
  - Recorded: 2026-10-10. REST account-trade catch-up now expects `order_fills` to dedupe by `(client_order_id, trade_id)` as well as execution ID. The schema definition includes the index, but any existing database that already applied the earlier live-order migration may not receive edits to that historical migration automatically.
  - Resolved: added forward-only migration `006_order_fills_trade_id_dedupe_index`, while keeping the same index in `004_live_order_execution_schema` for fresh database clarity.
  - Duplicate historical rows: if an existing database already contains duplicate `(client_order_id, trade_id)` rows, PostgreSQL will reject the unique index creation. That is intentional fail-closed behavior; an operator must inspect and repair the duplicate fills before rerunning migrations so accounting is not silently rewritten.
  - Result: migration tests now prove the trade-id dedupe index exists as a separate migration after the original live-order execution schema.

- [x] **`reliability` / `prototype-gap`: Add REST account-trade catch-up after executor downtime.**
  - Recorded: 2026-10-08. Phase 3.2 persisted live user-data execution reports into `order_fills` and reconciled order state on startup/reconnect by querying orders, but it did not query Binance account trade history to backfill fills missed while the executor was offline.
  - Resolved: added signed `/api/v3/myTrades` account-trade reads to the Binance account/Testnet client, added executor account-trade catch-up after startup/reconnect reconciliation, and hardened `order_fills` with `(client_order_id, trade_id)` idempotency in addition to execution ID. Catch-up persists exact Decimal-string fills through the existing `recordOrderExecutionUpdate` path, so duplicate trades are ignored and older REST catch-up events cannot move order state backwards.
  - Result: mocked/unit tests prove missed REST trades become persisted fills, duplicate trade identity is safe, older catch-up data uses the existing monotonic event-time guard, and startup/reconnect can invoke catch-up for reconciled orders. Follow-up bounded live fixture `missfill-739454811c0f4f2fb3c2` placed two BTCUSDT IOC Testnet orders with user-data persistence intentionally skipped; reconciliation found both as terminal-on-exchange, REST `/myTrades` persisted both fills, and own open orders ended at zero. Artifact: `apps/executor/logs/verification/missfill-739454811c0f4f2fb3c2.json`.

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
