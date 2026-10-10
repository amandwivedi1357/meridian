# Phase Roadmap

Source of truth: `docs/implementation-plan.md`.

## Current Position

Phase 3.4 is locally complete. Phase 3.5 is partially verified, not accepted as complete.

Current next phase:

- Remaining Phase 3.5 acceptance work

## Completed Highlights

- Phase 0 foundation and tooling
- Phase 1 ingestion foundation
- Binance REST and WebSocket market clients
- stream parsers and normalized market events
- local order book, depth sync, resync orchestration, metrics
- Redis Streams publishing and consumer helpers
- TimescaleDB/Postgres market storage
- NDJSON session recording
- Phase 2 backtesting foundation
- shared `Strategy` / `StrategyContext`
- simulated broker, fee-aware accounting, indicators, strategies
- recorded-session feed and HTML reports
- Phase 3.1 authenticated Binance Spot Testnet client
- shared `ExchangeGateway` / `MarketDataSource` contracts
- read-only and place/query/cancel Testnet smokes verified
- Phase 3.2 order lifecycle
- deterministic `clientOrderId`
- write-ahead order persistence
- startup/reconnect reconciliation foundation
- persisted execution reports and fills
- Phase 3.3 engine and executor services
- protobuf market `EventCodec` by default
- live strategy account context from persisted fills plus Testnet account balances
- signal consumption, expiry, write-ahead, risk hook, Testnet placement path
- Phase 3.4 risk engine local implementation
- durable fail-closed kill switch
- risk reservations and limits
- persisted `risk_events`
- daily loss and drawdown breakers
- partial Phase 3.5 verification with disposable infrastructure

## Next

Remaining Phase 3.5:

- resolve or explicitly document the claim-before-send liveness boundary
- clean recorded-kline/live-signal parity
- real end-to-end strategy/risk/executor/user-data fill flow
- real kill-switch cancellation verification
- 48h unattended Testnet paper-trading run
- screen recording of trading plus kill-switch activation

After Phase 3.5:

- Phase 4 API gateway and dashboard

Related:

- [[04 Current State]]
- [[25 Execution and Risk]]
- [[26 Observability]]
