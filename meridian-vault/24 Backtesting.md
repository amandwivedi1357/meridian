# Backtesting

Backtesting will replay historical market data through the same strategy interface used by live trading.

## Goal

Avoid building separate strategy logic for backtests and live execution.

## Planned Features

- deterministic simulated clock
- closed-candle-only guard
- simulated broker
- fees and slippage
- exchange filters
- metrics like Sharpe, drawdown, win rate, exposure
- parity tests between recorded live session and backtest replay

Related:

- [[25 Execution and Risk]]
- [[23 TimescaleDB]]
- [[92 Resume Story]]

