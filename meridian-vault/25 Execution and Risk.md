# Execution and Risk

Execution is implemented as a local/tested service flow. The Phase 3.4 risk engine is locally complete, but full live acceptance is still Phase 3.5 work.

## Implemented Execution Foundation

- signed Binance Spot Testnet client
- deterministic `clientOrderId`
- write-ahead order persistence before exchange send
- query-before-retry placement path
- startup and reconnect reconciliation foundation
- persisted user-data execution reports and fills
- executor signal consumer
- signal expiry handling
- risk engine before order send
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
  -> validation and risk engine
  -> write-ahead order record
  -> Testnet placement gateway
```

## Implemented Risk Controls

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

## Remaining Verification

- claim-before-send ambiguity is safe but still manual/fail-closed
- clean recorded-kline/live-signal parity remains open
- real end-to-end strategy/risk/executor/user-data fill flow remains open
- real kill-switch cancellation timing remains open
- 48h unattended Testnet paper-trading run has not happened
- screen recording has not been produced

## Do Not Overclaim

Safe to say:

- Phase 3.3 core service flow is locally implemented and tested.
- Order execution has idempotency and reconciliation foundations.
- Phase 3.4 risk engine is locally implemented and unit/integration tested.
- Phase 3.5 is partially verified with disposable infrastructure.

Not safe to say yet:

- production-ready trading bot
- verified 48h unattended paper trading
- real exchange fill loop proven end to end
- final Phase 3.5 acceptance complete

Related:

- [[24 Backtesting]]
- [[26 Observability]]
- [[92 Resume Story]]
