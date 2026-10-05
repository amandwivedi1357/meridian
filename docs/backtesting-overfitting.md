# Backtesting Overfitting Note

Backtest results are useful only if we treat them as estimates, not proof.

## Current Guardrails

- The backtester uses closed candles only.
- Orders created on candle `N` cannot fill before candle `N+1`.
- Fees and slippage are included in the simulated broker.
- Reports include buy-and-hold comparison so strategy returns are not viewed in isolation.
- Walk-forward reporting separates train windows from out-of-sample test windows.
- Saved reports persist params, metrics, fills, and equity points so a run can be reviewed later instead of retuned silently.

## Overfitting Risks

- Repeatedly changing EMA periods, grid spacing, or sizing after seeing test results can fit noise.
- A single market regime, such as one month of BTCUSDT, is not enough evidence for production readiness.
- Optimizing only total return can hide drawdown, low trade count, or poor benchmark-relative performance.
- Running many parameter sweeps increases the chance of finding a lucky configuration by accident.

## Out-Of-Sample Rule

For Phase 2 and later demos:

1. Choose a train window and tune only on that window.
2. Run the chosen params on the following test window without edits.
3. Prefer strategies that survive multiple test windows, not one best-looking result.
4. Compare every report against buy-and-hold.
5. Keep fees and slippage enabled.

## Status

The code now supports the mechanics needed for this workflow: deterministic backtests, saved runs, HTML reports, walk-forward windows, and a worker-thread/queue foundation for sweeps. A future full validation run still needs enough historical data loaded locally, preferably at least six months across the intended symbols.
