# ADR-006: Decimal Arithmetic Everywhere

## Status

Proposed

## Context

Binary floating point is unsafe for prices, quantities, fees, and PnL.

## Decision

Use `decimal.js` in TypeScript, `NUMERIC` in PostgreSQL, and decimal strings in serialized events.

## Consequences

Money math is explicit and safer. Developers must avoid `number` for monetary values.
