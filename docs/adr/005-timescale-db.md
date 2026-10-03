# ADR-005: TimescaleDB

## Status

Proposed

## Context

Market data is naturally time-series data, while orders, fills, strategies, and audit logs are relational.

## Decision

Use PostgreSQL 16 with TimescaleDB for hypertables, compression, and continuous aggregates.

## Consequences

One database can cover time-series and relational data. Migrations and numeric precision need careful handling.
