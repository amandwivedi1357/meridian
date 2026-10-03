# ADR-003: Single Strategy Interface

## Status

Proposed

## Context

Backtest/live divergence is one of the easiest ways for a trading system to lie to its operator.

## Decision

Strategies implement one TypeScript interface and receive a mode-specific `StrategyContext`.

## Consequences

Backtests and live execution share strategy code. Strategies must avoid direct I/O, wall-clock access, and unseeded randomness.
