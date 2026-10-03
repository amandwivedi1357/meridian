# ADR-007: Testnet Execution With Production Market Data

## Status

Proposed

## Context

The system should observe realistic market movement while never risking real funds in v1.

## Decision

Use Binance production public streams for market data and Binance Spot Testnet for order execution.

## Consequences

Signals see real market shape, while order fills remain paper/testnet only. Documentation must clearly label Testnet behavior and limitations.
