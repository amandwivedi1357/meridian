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

- [x] **`correctness` / `testing`: Restore green workspace-package build/typecheck state after source/dist drift.**
  - Recorded: 2026-10-05. `@meridian/ingestor` had failed typecheck/test because it resolved stale built declarations from `@meridian/proto` and `@meridian/config`.
  - Resolved: ran `pnpm install`, rebuilt `@meridian/proto` and `@meridian/config`, then verified `pnpm --filter @meridian/ingestor typecheck` and `pnpm --filter @meridian/ingestor test`.
  - Result: ingestor typecheck passed; ingestor tests passed with 72 tests across 27 files.

- [x] **`correctness` / `prototype-gap`: Dashboard API package must typecheck from a clean install/build.**
  - Recorded: 2026-10-05. `@meridian/api` had previously failed with missing dependency/type and strict TypeScript errors.
  - Resolved: after `pnpm install`, `pnpm --filter @meridian/api typecheck` passed without code changes.

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
