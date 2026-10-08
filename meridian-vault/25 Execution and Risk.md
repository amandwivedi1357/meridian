# Execution and Risk

Execution is now implemented as a local/tested service flow. The full risk engine is the next major phase.

## Implemented Execution Foundation

- signed Binance Spot Testnet client
- deterministic `clientOrderId`
- write-ahead order persistence before exchange send
- query-before-retry placement path
- startup and reconnect reconciliation foundation
- persisted user-data execution reports and fills
- executor signal consumer
- signal expiry handling
- risk-gate hook before order send
- local service loops for engine and executor
- live strategy account context from persisted fills plus Testnet account balances

## Current Engine to Executor Flow

```txt
market stream
  -> ingestor publishes protobuf market event
  -> engine consumes market event
  -> strategy runs with StrategyContext
  -> engine publishes Signal
  -> executor consumes Signal
  -> validation and risk hook
  -> write-ahead order record
  -> Testnet placement gateway
```

## Next Risk Goals

- max notional checks
- position limits
- open order limits
- daily loss checks
- drawdown checks
- stale-data guard
- price sanity checks
- global kill switch
- persisted `risk_events`
- cancel-all when kill switch engages
- fail-closed behavior when Redis/DB/risk state cannot be read

## Do Not Overclaim

Safe to say:

- Phase 3.3 core service flow is locally implemented and tested.
- Order execution has idempotency and reconciliation foundations.

Not safe to say yet:

- production-ready trading bot
- complete risk management
- verified 48h unattended paper trading
- kill switch proven in chaos tests

Related:

- [[24 Backtesting]]
- [[26 Observability]]
- [[92 Resume Story]]

