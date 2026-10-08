# TimescaleDB

TimescaleDB will store historical market data and trading records.

## Planned Tables

Likely early tables:

- trades
- klines
- order book snapshots or sampled depth
- backtest runs
- backtest trades
- orders
- fills
- positions
- risk events

## Why TimescaleDB

- PostgreSQL compatibility
- time-series optimized hypertables
- compression
- continuous aggregates
- good for dashboards and backtests

Related:

- [[22 Redis Streams]]
- [[24 Backtesting]]
- [[27 Dashboard]]

