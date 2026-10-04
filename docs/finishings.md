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

## Resolved Items

No resolved finishing items yet.

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
