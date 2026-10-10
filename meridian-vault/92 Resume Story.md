# Resume Story

Meridian should tell a strong engineering story.

## Strong Claims To Earn

- Built an event-driven trading platform in TypeScript.
- Implemented exchange-documented local order book synchronization.
- Verified order book behavior with property-based tests.
- Used Redis Streams for reliable event-driven ingestion.
- Stored historical data in TimescaleDB.
- Built a unified strategy interface for backtesting and live trading.
- Implemented crash-safe order execution with reconciliation.
- Added risk controls and kill switch.
- Shipped Prometheus/Grafana observability.

## Current Earned Claims

- TypeScript monorepo for an event-driven trading platform.
- Decimal-safe market data parsing and domain modelling.
- Binance REST/WebSocket public market client.
- Local order book with sequence-gap detection, automatic resync, property tests, and metrics.
- Redis Streams based event flow for market data and trading signals.
- TimescaleDB/Postgres persistence for market data, orders, and fills.
- NDJSON session recordings for replay/evidence.
- Backtesting worker with shared strategy interface, simulated broker, fee-aware accounting, indicators, reports, and sweep foundation.
- Authenticated Binance Spot Testnet client with signed order/account flows.
- Deterministic client order IDs and write-ahead persistence before exchange submission.
- Query-before-retry order placement path to avoid blind duplicate sends.
- Startup/reconnect reconciliation foundation for local orders vs exchange state.
- Engine service that consumes market streams, runs strategies, and publishes expiring signals.
- Executor service that consumes signals, validates, applies a risk hook, persists pending orders, and routes to the Testnet gateway.
- Protobuf-backed market event codec by default, with JSON debug/legacy fallback.
- Live strategy account context from persisted fills and Testnet account balance snapshots.
- Local risk engine with notional, quantity, position/exposure, open-order, orders/minute, daily-loss, drawdown, freshness, and price-sanity checks.
- Durable fail-closed kill switch with audit/risk event persistence.
- Opt-in disposable infrastructure tests for signal/fill flow, process-kill recovery boundaries, write-ahead failure, and Redis outage behavior.

## Claims Still To Earn

- Exchange metadata/filter preflight.
- Clean recorded-kline/live-signal parity.
- Real exchange fill delivery through user-data stream.
- Real kill-switch cancellation timing.
- 48h unattended Testnet paper-trading run.
- Demo/screen recording of trading and kill-switch activation.
- Production-grade API/dashboard UX.

Related:

- [[01 Project Vision]]
- [[20 Order Book]]
- [[25 Execution and Risk]]
- [[26 Observability]]
