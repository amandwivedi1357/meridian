# Phase Roadmap

Source of truth: `docs/implementation-plan.md`.

## Current Position

Phase 3.3 is complete in local code/tests.

Current next phase:

- Phase 3.4 Risk engine

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

## Next

Phase 3.4:

- complete the risk engine checks from TRD section 4.10
- orders/minute limits
- daily loss and drawdown breakers
- price sanity bands
- durable risk-state wiring
- persisted `risk_events`
- global kill switch that fails closed
- cancel-all behavior when kill switch engages

After Phase 3.4:

- Phase 3.5 integration, chaos, parity, and fail-closed verification
- 48h unattended Testnet paper-trading run
- Phase 4 API gateway and dashboard

Related:

- [[04 Current State]]
- [[25 Execution and Risk]]
- [[26 Observability]]

