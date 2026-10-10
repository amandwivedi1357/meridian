# Architecture Map

High-level implemented flow:

```txt
Binance REST + WebSocket
        |
        v
packages/binance-client
  - REST market data
  - WebSocket streams
  - authenticated Spot Testnet client
  - account snapshots
        |
        v
apps/ingestor
        |
        +--> Redis Streams
        |      - protobuf market payloads by default
        |      - JSON debug/legacy fallback
        |
        +--> TimescaleDB
        |
        +--> NDJSON session recordings
        |
        v
apps/engine
  - consumes market streams
  - runs strategies through shared Strategy interface
  - refreshes live account context
  - publishes expiring Signals
        |
        v
apps/executor
  - consumes signals
  - validates/risk-hook
  - write-ahead order persistence
  - query-before-retry placement gateway
  - startup/reconnect reconciliation
        |
        v
Binance Spot Testnet
        |
        v
apps/api -> apps/web
```

## Packages

- `packages/core`: shared domain types and strategy contracts
- `packages/binance-client`: Binance REST, streams, parsers, local order book, signed Testnet order/account clients
- `packages/config`: environment validation
- `packages/observability`: logger and metrics registry
- `packages/bus`: Redis Streams abstraction
- `packages/db`: migrations, Timescale/Postgres access, order write-ahead, order fills

## Apps

- `apps/ingestor`: market data ingestion service
- `apps/engine`: live strategy runtime and signal publisher
- `apps/executor`: Testnet execution and reconciliation service
- `apps/api`: early dashboard API; full API gateway remains Phase 4
- `apps/web`: temporary dashboard/prototype UI; production dashboard remains Phase 4
- `apps/backtest-worker`: backtest execution worker, reports, sweep foundation
- `apps/mcp-server`: planned AI/MCP read and control layer

## Current Boundary

Completed through local code/tests:

- Phase 1 ingestion foundation
- Phase 2 backtesting/reporting foundation
- Phase 3.1 authenticated Testnet client and shared adapters
- Phase 3.2 order lifecycle, reconciliation foundation, persisted fills
- Phase 3.3 engine plus executor service flow
- protobuf-backed market `EventCodec` default with JSON fallback
- live strategy account context from persisted fills plus signed Testnet balances
- Phase 3.4 local risk engine
- durable fail-closed kill switch
- persisted risk events
- partial Phase 3.5 disposable infrastructure verification

Still pending before calling this production-grade:

- exchange metadata/filter preflight
- clean recorded-kline/live-signal parity
- actual live fill flow
- real kill-switch cancellation timing
- 48h unattended Testnet paper-trading run
- screen recording/demo evidence
- Phase 4 real API/dashboard

Related:

- [[03 Phase Roadmap]]
- [[20 Order Book]]
- [[22 Redis Streams]]
- [[23 TimescaleDB]]
